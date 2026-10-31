import type { TopicDelta, TopicName, TopicParams, TopicSnapshot } from '@protocol';
import { applyEntitiesDelta } from '../views/entities_model';
import { applyHttpDelta } from '../views/http_model';
import { applyLogsDelta } from '../views/logs_model';
import { applyAppsDelta } from '../views/apps_model';
import { applyLifecycleDelta } from '../views/overview_model';
import { applyPluginsDelta } from '../views/plugins_model';
import { applyResumablesDelta } from '../views/resumables_model';
import { applySchedulesDelta } from '../views/schedules_model';
import { applyStorageDelta } from '../views/storage_model';

/** Fold a topic delta into its current snapshot. Pure: returns `cur` itself when nothing changed */
export type TopicReducer<T extends TopicName> = (cur: TopicSnapshot<T>, delta: TopicDelta<T>, params: TopicParams<T>) => TopicSnapshot<T>;

/** The delta is a full, fresh snapshot: replace, never merge (cleared fields such as `failure` must clear) */
const replace = <S,>(_cur: S, next: S) => next;

/**
 * How each topic's deltas fold into its snapshot. Keyed by topic, not per subscriber: subscribers to one
 * (topic, params) share a single subscription, so the data has to be one thing. Adding a topic is a compile error until it has an entry.
 */
export const TOPIC_REDUCERS: { [T in TopicName]: TopicReducer<T> } = {
    system: (cur, d) => 'state' in d ? d : { ...cur, ...d },
    counts: replace,
    apps: applyAppsDelta,
    lifecycle: applyLifecycleDelta,
    plugins: applyPluginsDelta,
    app: replace,
    orphan: replace,
    appEntities: applyEntitiesDelta,
    entities: applyEntitiesDelta,
    entity: replace,
    appConfig: replace,
    appStorage: applyStorageDelta,
    appResumables: applyResumablesDelta,
    appHttp: applyHttpDelta,
    appSchedules: applySchedulesDelta,
    schedules: applySchedulesDelta,
    resumables: applySchedulesDelta,
    logs: (cur, d, params) => applyLogsDelta(cur, d, params.limit),
};
