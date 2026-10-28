import { count } from "./shared.ts";
count();
count();
declare var self: Worker;
const list: number[] = [1, 2, 3];
self.onmessage = event => {
  self.postMessage("w1 " + count() + " got " + event.data + " " + list.map(x => x * 2).join());
};
