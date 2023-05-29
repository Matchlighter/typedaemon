import { Axios } from "axios";

export const SUPERVISOR_API = process.env['SUPERVISOR_TOKEN'] ? null : new Axios({
    baseURL: "http://supervisor",
    headers: {
        "Authorization": `Bearer ${process.env['SUPERVISOR_TOKEN']}`,
    },
})
