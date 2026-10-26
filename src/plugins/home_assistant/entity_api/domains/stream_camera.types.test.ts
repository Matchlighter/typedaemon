import { typeTest } from "../../../../../test/helpers/types";
import type { Application as AppBase } from "../../../../runtime/application";

declare const Application: typeof AppBase;

type Entities = import("../../api").HomeAssistantApi["entity"];
declare const entity: Entities;

describe("stream camera API typing", () => {
    typeTest("is exposed under its own key with stream-camera options, leaving the MQTT camera's options alone", () => {
        new entity.stream_camera("door", { still_image_url: "http://cam/still.jpg" }).setState("rtsp://cam");
        entity.stream_camera({ id: "door", still_image_url: "http://cam/still.jpg", auto_clean: true });
        entity.camera({ image_encoding: "b64" });

        // README example
        class App extends Application {
            @entity.stream_camera({ id: "front_door", name: "Front Door", still_image_url: "http://cam.lan/snapshot.jpg" })
            accessor front_door_stream = "rtsp://cam.lan:554/main";
        }

        // @ts-expect-error MQTT camera option
        entity.stream_camera({ image_encoding: "b64" });
        // @ts-expect-error state is the stream URL
        new entity.stream_camera("door").setState(Buffer.from([]));
    });
});
