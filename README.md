# TypeDaemon

Typescript-based application environment for Home Assistant. Similar in principle to AppDaemon, but swaps Python for Javascript/Typescript.

Aims to "include the batteries", providing simple, clean APIs for writing automations - just take a look at the [example](skel/applications/full_app/index.ts).

TypeDaemon is still a work in progress. It works to do what I do in my production Home Assistant and has been stable, but it is still beta software - there are probably bugs and things may change.

## Installation

### Hassio (Recommended)
1. Add the https://github.com/Matchlighter/typedaemon-hassio repository by:
    1. Navigating to Home Assistant Settings > Addons > Add-on Store
    2. Access the kebab menu in the upper right, and select "Repositories"
    3. Paste `https://github.com/Matchlighter/typedaemon-hassio` in the "Add" field, then click "ADD".
2. Reload the page
3. Find the TypeDaemon section and select the TypeDaemon addon
4. Install it

### Docker/Compose
Installation outside of Hassio is technically possible, but I've chosen not to allocate time figuring it out and writing docs. If you're going to go this direction, you should have an intermediate understanding of Linux and Docker, and be willing to spend some time digging and throwing stuff at the wall.

I'm happy to entertain a PR that fills in this section more.

## Getting Started

Upon startup, TypeDaemon will create a template configuration (at `/config/typedaemon` for Hassio, or in the directory mounted to `/config` for Docker/Compose).

Presently, the only API documentation that TypeDaemon provides is via Typescript and JSDoc comments, so it is highly recommended to use VS Code / Studio Code Server when writing TypeDaemon apps. All APIs and utilities provided by TypeDaemon can be imported from `@td`. Check out the example app templates to get a feel for things.

### CLI Basics
TypeDaemon has a simple CLI for doing some basic tasks. For Hassio installs, you can run `./td --help` from the `typedaemon` config directory.

TypeDaemon runs completely in Docker, but apps/config are expected to be edited outside of Docker. This split would normally require you to be highly aware of where you're executing commands, with some commands only working if you properly enter the Docker container before execution. The TypeDaemon CLI tries to simplify this and work some magic to automatically enter the container and map paths when necessarry.

You can execute an arbitrary command in-container with `./td exec CMD`. You can easily gain an in-container shell with `./td shell`.

Some other useful commands:
- `./td repl` - Open a Node REPL inside the running TypeDaemon process. `hypervisor` is available as a global.
- `./td delete APP` - Remove everything an app left behind (auto-cleaned entities, persistence, logs) after it was removed from the config.
- `./td clean` - Like `delete`, but for every app that is no longer in the config. Both ask for confirmation unless passed `--yes`.
- `./td yarn ...` and `./td patch-package ...` - Run `yarn`/`patch-package` in-container in the current directory (eg in an app with its own `package.json`).

The container also runs an SSH server on port `7722` (key auth only, as `root`, using the key at `.typedaemon/connection_key`, which is only readable by the owner of the config dir). `td` reads `.typedaemon/connection_params` and tries these routes in order, using the first that works:
1. **Local socket** (`.typedaemon/ssh_sock`) - automatic when `td` runs on the container's host. Needs `socat`.
2. **Direct TCP** - set `TD_SSH_HOST=host:port` (in the environment or `connection_params`) and publish port `7722` (the Home Assistant add-on has it disabled until you set a host port).
3. **[tailcat](https://github.com/tailscale/tailcat)** - remote access with no open port. Enable the add-on's `tailcat` option (or set `TYPEDAEMON_TAILCAT=true` when running plain Docker) and restart; TypeDaemon generates a saved key and writes `TD_TAILCAT_ADDR` to `connection_params`. Anyone with that address can reach sshd (which still requires the login key), so treat it as a secret. `td` needs the `tailcat` binary on `PATH` (or in `.typedaemon/bin`).

To use TCP/tailcat from another machine, copy `.typedaemon/connection_params` and `.typedaemon/connection_key` along with the `td` script. TypeDaemon only rewrites `TD_CONNECTION_MODE` and `TD_TAILCAT_ADDR` in `connection_params`; other lines are kept.

### Syncing the Dev Environment
TypeDaemon tries to abstract the need for you to learn how JS packaging and NPM work. It does this by generating the appropriate configs and automagically downloading appropriate typings and support files. This process occurs automatically upon first startup and when TypeDaemon detects that it was updated, but you can also manually trigger this by running `./td dev_env`

### Home Assistant Integration
Some features (custom Actions, stream cameras) require the TypeDaemon companion integration to be installed in Home Assistant:
1. Install via [HACS](https://hacs.xyz): HACS > ⋮ > Custom repositories > add `https://github.com/Matchlighter/typedaemon` as type *Integration*, then download *TypeDaemon*.
   (Manual alternative: copy [`custom_components/typedaemon`](custom_components/typedaemon) to `custom_components/typedaemon` in your HA config directory.)
2. Restart Home Assistant
3. Add the TypeDaemon integration via Settings > Devices & Services > Add Integration

Apps can then register Actions callable from HA as `typedaemon.<app uuid>_<id>` (names are slugified; pass `app_prefix: false` in the options to register as `typedaemon.<id>` instead - names are then global across apps):
```ts
@ha.action("announce", { description: "Announce a message", fields: { message: { required: true, selector: { text: {} } } } })
async announce(data: { message: string }) {
    ...
    // Optionally return an object to be used as the Action's response data
    return { announced: true };
}
```

#### Cameras: snapshot vs stream
TypeDaemon has two camera entity types, picked by which one you use (they're separate entity kinds, so ids don't clash):
- `ha.entity.camera` - **snapshot** camera over MQTT. State is the image bytes; HA shows the last image pushed. No companion integration needed, but no live video.
- `ha.entity.stream_camera` - **live stream** camera via the companion integration. State is a stream URL (RTSP/HLS/... - anything HA's `stream` integration accepts), which HA serves to the frontend as HLS/WebRTC. Stills come from `still_image_url` if given, otherwise from the stream.

```ts
@ha.entity.stream_camera({ id: "front_door", name: "Front Door", still_image_url: "http://cam.lan/snapshot.jpg" })
accessor front_door_stream = "rtsp://cam.lan:554/main";
```

Changing the value (or name/attributes) updates the camera in HA. Stream cameras are available while TypeDaemon is connected to HA's websocket and removed from HA when no longer declared (autoclean). In HA they're attached to a TypeDaemon-integration device mirroring the app's device (HA doesn't share devices across integrations), not to the app's MQTT device.

## Where thar be Dragons

### Using the edge/dev Version

The TypeDaemon edge/dev addon does not auto-update. To pull the latest version, run `docker pull ghcr.io/matchlighter/typedaemon:edge` and restart the addon. The edge image is built from the latest code pushed to the `master` branch of this repo.

## LICENSE
Currently licensed under the terms of the AGPLv3. This is mostly due to the `@resumable` stuff, which I consider to be pretty neat tech, so I want to keep it under my control. If you're using this project personally, you probably don't need to worry much about this. If you're using it (or parts of it) commercially, the AGPLv3 is to apply in full and requires any derivative works to be released under the same license.
