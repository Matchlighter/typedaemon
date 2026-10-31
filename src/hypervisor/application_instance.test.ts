import { ApplicationInstance } from './application_instance';
import { BaseInstance } from './managed_apps';

describe('ApplicationInstance', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        // Avoid creating real log files
        jest.spyOn(BaseInstance.prototype as any, '_updateLogConfig').mockImplementation(() => { });
        jest.spyOn(BaseInstance.prototype, 'logMessage').mockImplementation(() => { });
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    test('a source change restarts every app depending on it', () => {
        const namespace = { reinitializeInstance: jest.fn() };
        const makeApp = (id: string) => new ApplicationInstance({ id, namespace, hypervisor: {} } as any, { source: "shared.ts" } as any);

        const appA = makeApp("a");
        const appB = makeApp("b");

        (appA as any).restartAfterSourceChange();
        (appB as any).restartAfterSourceChange();
        jest.advanceTimersByTime(2500);

        expect(namespace.reinitializeInstance).toHaveBeenCalledTimes(2);
        expect(namespace.reinitializeInstance).toHaveBeenCalledWith(appA, 'source_change');
        expect(namespace.reinitializeInstance).toHaveBeenCalledWith(appB, 'source_change');
    });
});
