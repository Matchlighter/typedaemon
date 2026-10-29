import axios from "axios";

/** Supervisor API client; only present when running as a Home Assistant add-on (`SUPERVISOR_TOKEN` injected) */
export const SUPERVISOR_API = process.env['SUPERVISOR_TOKEN'] ? axios.create({
    baseURL: "http://supervisor",
    headers: {
        "Authorization": `Bearer ${process.env['SUPERVISOR_TOKEN']}`,
    },
}) : null;
