// start.ts is the program: it starts this file as a Worker through `new URL("./main.ts", import.meta.url)`. The worker's functions are named only in this file, and it exports some that nothing imports.
import { shared } from "./shared";

function compute(n: number): number { return double(n) + 1; }
function double(n: number): number { return n * 2; }
export function exportedByTheWorker() { return "exported by the worker"; }

declare var self: Worker;
self.onmessage = event => {
  postMessage(shared("worker") + " " + compute(event.data));
};
