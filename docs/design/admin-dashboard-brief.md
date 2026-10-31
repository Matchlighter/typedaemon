# Design Brief: TypeDaemon Admin Dashboard

## 1. Product context

TypeDaemon is a TypeScript automation runtime for Home Assistant (HA) — like AppDaemon, but JS/TS. It runs as a Home Assistant add-on (Docker). Users write **apps** (TS files/packages) in VS Code / Studio Code Server; a single long-running **Hypervisor** process loads them, sandboxes each in its own VM, and hot-reloads them when source or config changes.

Today there is **no UI**. All insight comes from log files and a CLI. The dashboard is an operator console: "what is running, what is it doing, what did it leave behind, and let me clean it up."

**Users:** one technical person per install (home-automation hobbyist and developer). Comfortable with code, entity IDs, and JSON. They want density and precision, not onboarding.

**Primary context of use:**
- Embedded in the Home Assistant sidebar via **HA Ingress** (iframe in HA's frontend). Must look at home next to HA, and work in HA's light and dark themes.
- Opened on the side while coding, to check whether an app restarted cleanly after a save.
- Sometimes on a phone (HA companion app) to check status or kill a runaway script.

**Auth:** handled upstream by HA Ingress. No login screen needed.

## 2. Domain model (what the UI shows)

| Concept | What it is | Key fields |
|---|---|---|
| **Hypervisor / System** | The daemon process | version, uptime, state (`running` / `shutting_down`), config file path, timezone/location |
| **Plugin** | Connection to an outside system. Built-in types: `home_assistant`, `mqtt`, `http`. Several instances of a type are possible. | id, type, state, connection target (URL), log level |
| **App** | User code instance declared in config. Several instances can share one source file. | id, uuid, human_name, source path, export, lifecycle state, "thick" (own package.json) vs "lite", app config (JSON), dependencies, log level |
| **App lifecycle state** | `initializing → compiling → starting → started → stopping → stopped`, or `dead` (failed at startup, but its watchers stay live so it restarts on the next file save) | state, time entered, last error + source-mapped stack trace |
| **Orphaned app** | Removed from config, but its operating dir and **destroyers** (cleanup jobs) still exist. Example: HA entities it created are still in HA. | id, leftover data, pending destroyers |
| **Entity** | HA entity an app publishes (over MQTT discovery) or links (HA `input_*` helpers). Domains: sensor, binary_sensor, switch, button, number, select, text, light, lock, image, scene, event, device_tracker, device_trigger, input_* | entity_id/uuid, domain, name, owning app, current state + attributes, **linked** (an app currently registers it) vs **unlinked** (exists in HA / autoclean registry, but no running app claims it), auto_clean flag, persist_state flag |
| **Persistent entry** | Key/value in an app's journaled store (`@persistent` props, `persistence.set()`, plus internal keys such as entity state and autoclean registry). Shared stores also exist across apps. | key, value (any JSON), size, internal-vs-user flag, last write |
| **Resumable** | Long-running `@resumable` method or `@script({shutdown:'suspend'})` run that survives restarts (serialized at shutdown, resumed at start). | type, owner app, method, parameters, status (running / suspended / **failed to resume**), started at, what it is waiting on (sleep until X, wait for condition) |
| **Script run** | `@script` executions with modes (single / restart / queued / parallel) and limits | script name, mode, running count / limit, queued count |
| **Schedule** | `@schedule` / `run_every` / `run_in` / `run_at` / cron / sun-relative (`sunset+1:00`) | owner app, expression (as written), next fire time, last fire time, last result |
| **HTTP handler** | Routes an app registers on the HTTP plugin (served at `/app/<uuid>/...`) | method, path, full URL, static mounts |
| **Cross-app call** | Persisted RPC between apps; can be pending while the target is down | source → target, method, status (pending / started / returning), age, timeout |
| **Logs** | Per system, per plugin, and per app (manager logs and user logs). Levels: debug, info, warn, error, lifecycle | timestamp, level, source, message, stack |

## 3. Requirements

### 3.1 From the product owner (must have)

**View apps**
- List all apps, **including deleted apps that haven't been cleaned** (orphans), with a way to run their cleanup.
- Per app, show:
  - **HTTP handlers**
  - **Schedules**
  - **Persistent entries** — view and delete. *Delete removes the entry from the store and nothing more.* The UI must say this: the running app keeps its in-memory value until it writes again or restarts.
  - **Entities** — linked and unlinked. Allow **deleting an unlinked entity from HA**.
  - **Running resumable methods**

**Live updates (WebSocket subscriptions).** These views update in real time, with no manual refresh:
- **Apps** — status changes, apps created, apps deleted
- **App entities** — status, created, unlinked, destroyed
- **App resumables**
- **App storage** — every change, as deltas

### 3.2 Added (gaps that seem missing; mark any to cut)

1. **System overview / home** — overall health at a glance: counts of apps by state, dead apps, plugin connection status, orphans needing cleanup, failed resumes, TD version and uptime. This answers "is everything OK?" in under 2 seconds.
2. **Plugins view** — each plugin's state and connection (HA websocket connected, MQTT broker connected, HTTP port). A disconnected plugin is the most common root cause of "app won't start" (apps wait on `PluginNotStarted`), so it must be visible next to the app error.
3. **App error surfacing** — for `dead` apps, show the startup error with its **source-mapped stack trace**, prominently. This is the #1 reason to open the dashboard while developing.
4. **Log viewer** — live tail plus history, per app / plugin / system. Filter by level, search text, pause/resume tail, jump to the error that caused a state change. Collapsible stack traces.
5. **App actions** — **Restart** (re-init) per app. Optionally **Stop/Start**, but note: apps are declared in config, so "stopped" is a runtime-only override until the next config reload. The design should show that override state.
6. **Resumable / script actions** — **Cancel** a running resumable or script run (with confirm). Show **failed-to-resume** items distinctly: they are re-attempted on every start until fixed or discarded, so offer a **Discard**.
7. **Script runs** — running/queued counts against limits per `@script`.
8. **Cross-app calls** — pending calls, especially ones stuck because the target app is dead.
9. **Read-only config view** — the resolved config, effective after defaults and merges, per app and system. Source of truth stays the file; the UI does not edit config. Show the source file path, and a "copy path" button.
10. **Entity detail** — current state and attributes (live), domain icon, link to the entity in HA (`/config/entities` deep link), owning app, flags.
11. **Global search / command palette** — jump to any app, entity, or storage key by name.
12. **Connection indicator** — the dashboard's own WebSocket status. Reconnect transparently, and mark data stale while disconnected.

### 3.3 Non-goals
- Editing app source or config (VS Code is the editor).
- Creating apps from the UI.
- Multi-user, roles, auth UI.
- Metrics, charts, or historical time series (logs are enough for now).
- Per-app CPU/memory (all apps share one Node process, so this isn't measurable).

## 4. Information architecture (suggested; designer may revise)

```
Overview
Apps
  └ App detail (tabs): Overview · Logs · Entities · Storage · Resumables & Scripts · Schedules · HTTP · Config
     (orphan apps: no detail page; a Leftovers modal over the Apps list, with the Clean up confirmation)
Entities        (global, cross-app; filter by app, domain, linked/unlinked)
Plugins
  └ Plugin detail: status · logs · config
Logs            (global, all sources merged)
System          (version, config path, location/tz, shared storage, cross-app calls)
```

The global Entities and Logs pages exist because the common questions are "who owns `sensor.foo`?" and "what just happened across the board?"

## 5. Key screens and states

**Overview.** Health summary cards. Attention list: dead apps, disconnected plugins, orphans, failed resumes, stuck cross-calls. Each item deep-links to its fix. A recent lifecycle event feed (app X restarted at 14:02 after source change).

**Apps list.** Dense table/list: state badge, name/id, source file, uptime since last start, entity / schedule / resumable counts, last error snippet.
- Orphans are grouped separately with a "Clean up" action.
- Rows animate subtly when state changes live, e.g. `compiling → starting → started` during a hot reload. Users will watch this happen after hitting save.

**App detail.** Header: name, state, source path, restart action. Tabs as in the IA.
- **Entities tab:** linked/unlinked segmented filter. Unlinked rows get a destructive "Delete from HA".
- **Storage tab:** key list with JSON value viewer (collapsible, copy), and internal keys hidden behind a toggle. Changed keys flash on live delta. Delete opens a confirm that states the "store only" caveat.
- **Resumables tab:** running / suspended / failed groups, each showing what it's waiting on and since when.

**Destructive confirmations.** Delete entity from HA, delete storage key, clean up orphan, cancel resumable, discard failed resume. Each confirm names exactly what will happen and what won't. None of these can be undone.

**Required states for every list:** loading, empty (with a one-line explanation of what would populate it), error, and disconnected/stale.

## 6. Visual and interaction direction

- **Feel:** a calm, dense developer tool. Think HA's own settings pages, or Grafana/Portainer-level density. Not a consumer smart-home dashboard.
- **Match Home Assistant:** follow its frontend conventions (Material-ish, `ha-card`-like surfaces, MDI icons, HA primary blue). Respect light/dark from HA's theme, and also support standalone light/dark.
- **State color system** (needs to be consistent everywhere):
  - started = green
  - starting / compiling / initializing = blue, animated
  - stopping / stopped = neutral grey
  - dead = red
  - orphan = amber
  - unlinked entity = amber outline
  - failed resume = red
- **Monospace** for ids, paths, keys, JSON, cron/schedule expressions, and logs.
- **Times:** relative ("3 min ago", "in 2h 14m") with the absolute time on hover. Next-fire countdowns tick live.
- **Responsive:** desktop-first (wide, with a persistent sidebar nav). Usable at phone width (stacked cards, bottom actions). It renders inside HA's iframe, so there's no browser chrome, and HA's own header sits above it.
- **Accessibility:** state never conveyed by color alone (badge text/icon too), keyboard navigable, AA contrast in both themes.

## 7. Deliverables requested from design

1. Overview, Apps list (with orphan group), App detail (all tabs), Entities (global), Plugins, Logs, System.
2. Component sheet: state badges, entity row, storage key row + JSON viewer, resumable card, schedule row (expression + next fire), log line (collapsed/expanded stack), confirm dialog, connection/stale banner, empty states.
3. A hot-reload sequence: an app moving through `started → stopping → compiling → starting → started` in the list and the detail header. Plus the `dead` variant, with the error panel.
4. Light and dark, desktop and mobile, for Overview and App detail at minimum.

## 8. Example data (for realistic mocks)

- Apps:
  - `lights` (started, 14 entities, 6 schedules)
  - `hvac` (started, 2 resumables suspended-capable)
  - `notifier` (dead: `TypeError: Cannot read properties of undefined (reading 'state') at index.ts:42:17`)
  - `garage_door` (starting)
  - `old_presence` (orphan: 3 entities still in HA)
- Plugins: `home_assistant` (connected, `http://supervisor/core`), `mqtt` (connected, `mqtt://core-mosquitto:1883`), `http` (listening :9000)
- Entities:
  - `sensor.lights_scene_mode` (linked, persist_state)
  - `switch.hvac_away` (linked)
  - `binary_sensor.old_presence_home` (unlinked)
- Schedules:
  - `sunset-0:30`
  - `MON-FRI 6:45 AM`
  - `*/15 * * * *`
  - `run_every('5m')`
- Storage keys:
  - `@persistent-last_scene` → `"evening"`
  - `entity_state:lights_scene_mode` → `{state, attrs}`
  - `_destroyers` (internal)
- Resumables: `hvac:preheat_then_cool(["bedroom", 21])` — sleeping until 06:30, started 9h ago
- HTTP: `POST /app/notifier/webhook`, static `/app/lights/ui/*`

## 9. Constraints worth knowing (affect design, not just backend)

- Served by the Hypervisor's own HTTP listener (`dashboard.port`, default 8099), not the `http` plugin (:9000). Reached through HA Ingress (always allowed); direct access needs the opt-in `dashboard.token`. Either way all URLs must be relative (ingress path prefix).
- The live channel is one WebSocket with per-topic subscriptions (apps, per-app entities/resumables/storage). The UI subscribes only to what is on screen, so detail tabs may show a brief "syncing" state.
- Storage values can be large or deeply nested JSON. Values need truncation plus a lazy "expand" control.
- An app restart drops and recreates its entities/resumables/schedules within seconds. The UI must keep the user's place: selected tab, scroll, open JSON nodes.
