import { compose } from "./lib2";
declare var self: Worker;
self.onmessage = e => postMessage(compose((x: number) => x + 1, (x: number) => x * 2)(e.data));
