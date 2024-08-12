
import { UNREF_NOT_SUPPORTED, patchClassCleanup, registerPatch } from "./base";

import type * as net from 'net';

// Patch net for proper app cleanup
registerPatch(/^(node:)?net$/, (mod: typeof net) => {
    mod['Server'] = patchClassCleanup(mod.Server, ['close'], s => {
        try {
            s.close()
        } catch (e) {

        }
    });
    mod.Server.prototype.unref = UNREF_NOT_SUPPORTED;
    
    mod['Socket'] = patchClassCleanup(mod.Socket, ['destroy', 'end'], s => {
        try {
            s.destroy()
        } catch (e) {
            
        }
    });
    mod.Socket.prototype.unref = UNREF_NOT_SUPPORTED;
});
