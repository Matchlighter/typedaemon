/**
 * Import (first) to stub out the hypervisor modules that runtime code reaches for. The real modules pull in the whole
 * hypervisor (and circular imports with it), while the units under test only need logging and a `current` to point at.
 *
 * `current` is a plain object; tests may assign `current.application` etc. as needed.
 */

jest.mock("../../src/hypervisor/current", () => ({ current: {} }));
jest.mock("../../src/hypervisor/logging", () => ({
    logMessage: jest.fn(),
    logPluginClientMessage: jest.fn(),
}));

export { };
