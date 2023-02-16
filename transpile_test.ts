
import * as fs from "fs";
import { resumable } from "./src/runtime/resumable.macro"

function dec(...args) {
    console.log(args)
}

class Bob {
    @resumable
    steve() {
        fs.readFileSync("")
    }
}

const bob = new Bob();
bob.steve();
