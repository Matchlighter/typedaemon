import type { ApplicationInstance } from "../hypervisor/application_instance";
import type { Hypervisor } from "../hypervisor/hypervisor";
import type { ScheduleInfo } from "../runtime/schedule/registry";
import { followAppEmitter, type FollowAppHost } from "./follow_app";
import type { AppSchedulesSource } from "./app_schedules_topic";
import type { ScheduleRow } from "./protocol";

/** What the dashboard needs from the hypervisor (public API only) */
export type AppSchedulesHost = Pick<Hypervisor, 'currentConfig' | 'getApplication' | 'on' | 'off'>;

/** Tab/overview count: registered schedules */
/** Soonest pending schedule, for the overview card */
export function appNextSchedule(app: Pick<ApplicationInstance, 'schedules'>) {
    const pending = app.schedules.list().filter(s => s.nextAt !== undefined);
    if (!pending.length) return undefined;
    const next = pending.reduce((a, b) => (b.nextAt! < a.nextAt! ? b : a));
    return { expression: next.expression, at: next.nextAt! };
}

export const appScheduleCounts = (app: Pick<ApplicationInstance, 'schedules'>) => ({ schedules: app.schedules.list().length });

/** `cb` fires when the app's schedules may have changed; follows restarts onto the new instance */
export function observeAppSchedules(host: FollowAppHost, appId: string, cb: () => void): () => void {
    return followAppEmitter(host, appId, cb, app => [app?.schedules]);
}

const toRow = ({ id, ...rest }: ScheduleInfo): ScheduleRow => ({ key: String(id), ...rest });

export function hypervisorAppSchedulesSource(host: AppSchedulesHost): AppSchedulesSource {
    return {
        list(appId) {
            const app = host.getApplication(appId);
            if (app) return app.schedules.list().map(toRow);
            return host.currentConfig.apps?.[appId] ? [] : undefined;
        },
        onChange: (appId, cb) => observeAppSchedules(host, appId, cb),
    };
}
