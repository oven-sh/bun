// The main thread and a Worker started from an embedded file import the same module; each has its own copy of the module's state.
import w1 from "./w1.ts" with { type: "file" };
function ask(w: Worker, text: string): Promise<string> {
  return new Promise((resolve, reject) => {
    w.onmessage = e => {
      resolve(String(e.data));
      w.terminate();
    };
    w.onerror = e => {
      reject(new Error("worker error: " + e.message));
    };
    w.postMessage(text);
  });
}
import { count } from "./shared.ts";
console.log(count(), await ask(new Worker(w1), "a"), count());
