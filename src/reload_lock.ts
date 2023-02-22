
if (global['IS_TYPEDAEMON_VM'] || global["TYPEDAEMON_LOADED"]) {
    throw new Error(`Attempted to load a secondary instance of TypeDaemon! This likely means that you included typedaemon in a package.json!`);
}

global["TYPEDAEMON_LOADED"] = true;
