// start.ts is the program: it starts this file as a Worker by the string "./main.ts". only-worker.ts is imported by the worker alone, and one of its functions is called under a computed name.
import * as tools from "./only-worker";

declare var self: Worker;
self.onmessage = event => {
  postMessage((tools as Record<string, any>)[event.data]());
};
