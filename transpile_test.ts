
import * as fs from "fs";
import { resumable } from "./src"

resumable.register_context("bob", {})

function dec(...args) {
    console.log(args)
}

class Bob {
    @resumable
    async steve(a, b, c) {
        const x = 5;
        console.log(a)
        try {
            await 1;
        } catch (ex) {
            console.log("Caught")
        } finally {
            console.log("Finally")
        }
        if (true) {
            await 2
        } else {
            await 3
        }
        console.log(x)
        // fs.readFileSync("")
        return x;
    }
}

const bob = new Bob();
bob.steve(1, 2, 3);
