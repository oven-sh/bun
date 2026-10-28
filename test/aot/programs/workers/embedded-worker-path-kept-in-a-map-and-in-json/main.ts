// The path of an embedded file goes through a Map and through JSON text to `new Worker()`.
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
const m = new Map<string, string>([["k", w1]]);
const again = JSON.parse(JSON.stringify({ p: w1 })).p;
console.log(await ask(new Worker(m.get("k")!), "a"), await ask(new Worker(again), "b"));
