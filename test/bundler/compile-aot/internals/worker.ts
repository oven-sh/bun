import { use } from "./use.ts";
declare var self: Worker;
self.onmessage = async (e: MessageEvent) => { postMessage(await use(e.data)); };
