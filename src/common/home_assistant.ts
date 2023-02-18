import { ResumablePromise, SerializedResumable } from "src/runtime/resumable_promise";

export class HomeAssistantIntegration {
    for_event(event: string) {
        
    }
}

class EventAwaiter extends ResumablePromise<any>{
    serialize(): SerializedResumable {
        return {
            type: 'ha_event_waiter',
            sideeffect_free: true,
        }
    }
}
