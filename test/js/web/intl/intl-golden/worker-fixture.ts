import { observe } from "./evaluate";

declare const self: Worker;
self.onmessage = event => postMessage(event.data.map(observe));
