/**
 * Filter for `event.data`. Every key in the filter must strictly equal the corresponding key in the event's data.
 *
 * E.g. `{ device_id: "abc123", command: "on" }`
 */
export type EventDataFilter = Record<string, any>;

export function matchEventData(filter: EventDataFilter | undefined, data: Record<string, any> | undefined): boolean {
    if (!filter) return true;
    for (const [key, value] of Object.entries(filter)) {
        if (data?.[key] !== value) return false;
    }
    return true;
}
