
import { ha, lifecycle } from "@td";
import { autorun } from "mobx";

const select = new ha.entity.select("abc", {
    options: ["a", "b", "c"],
});

ha.registerEntity(select, {
    persist_state: true,
});

autorun(() => {
    console.log("Selected:", select.state);
})

lifecycle.on_shutdown(() => {
    console.log("Shutting down...");
});
