import { report } from "./report.ts";
declare var self: Worker;
self.onmessage = async () => { postMessage(await report()); };
