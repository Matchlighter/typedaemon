
export interface PersistentEntryOptions {
    maxWriteFrequency?: number;
}

export class PersistentStorage {
    notifyValueChanged(key: string, value: any, options: PersistentEntryOptions) {
        // TODO Schedule save according to saving frequencies
    }
}
