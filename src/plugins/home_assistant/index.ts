import { ResumablePromise, SerializedResumable } from "../../runtime/resumable_promise";

export class HomeAssistantIntegration {

}

class EventAwaiter extends ResumablePromise<any>{
    serialize(): SerializedResumable {
        return {
            type: 'ha_event_waiter',
            sideeffect_free: true,
        }
    }
}

export * as entity from "./entity_decorators";
