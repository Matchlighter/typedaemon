
import { LifecycleHelper } from "../../../common/lifecycle_helper";
import { ApplicationInstance } from "../../../hypervisor/application_instance";
import { current } from "../../../hypervisor/current";
import { EntityStore } from "./store";

export class TDDevice {
    // A link to the webpage that can manage the configuration of this device. Can be either an HTTP or HTTPS link.
    configuration_url?: string;

    // A list of connections of the device to the outside world as a list of tuples [connection_type, connection_identifier]. For example the MAC address of a network interface: "connections": [["mac", "02:5b:26:a8:dc:12"]].
    connections?: [string, string][];

    // A list of IDs that uniquely identify the device. For example a serial number.
    identifiers?: string | string[];

    // The manufacturer of the device.
    manufacturer?: string;

    // The model of the device.
    model?: string;

    // The name of the device.
    name?: string;

    // The firmware version of the device.
    sw_version?: string;
}

// uuid should be required when creating an Entity.

abstract class TDEntity<T> {
    constructor() {
        this.application = current.application;
    }

    abstract id: string;

    abstract uuid: string;

    get domain() {
        return this.id.split('.')[0];
    }

    protected readonly application: ApplicationInstance;
    protected _bound_store: EntityStore;

    // protected abstract _link(); // Connect to HA, ensure exists, bind data/events
    protected abstract _unlink(); // Unbind data/events, mark unavailable, remove from store
    protected abstract _destroy(); // _unlink() and remove from HA - the opposite of _link()

    /**
     * Completely disconnect this Entity from all events and from HA (but leave it as Unavailable in HA)
     */
    async unlink() {
        if (!this._bound_store) throw new Error("Not registered");
        await this._unlink();
        await this._disposers.cleanup();
    }

    // async relink() {
    //     if (!this._bound_store) throw new Error("Not registered");
    //     await this._link();
    // }

    protected _disposers = new LifecycleHelper();

    /**
     * Completely disconnect this Entity from all events and delete it from HA
     */
    async destroy() {
        if (!this._bound_store) throw new Error("Not registered");
        await this._destroy();
        await this._disposers.cleanup();
    }

    /** This should NOT be called by any applications - it should only ever be called by TypeDaemon. Use `ha.registerEntity()`. */
    protected abstract _register_in_ha(): any
}

export interface EntityOptions {
    id?: string;
    uuid?: string;
    name?: string;

    [key: string]: any;
}

export function resolveEntityId(domain: string, options: { id?: string }, decContext?: DecoratorContext) {
    let entity_id: string = options.id || decContext?.name as string;
    if (!entity_id.includes('.')) entity_id = domain + '.' + entity_id;
    return entity_id;
}

export { TDEntity };
