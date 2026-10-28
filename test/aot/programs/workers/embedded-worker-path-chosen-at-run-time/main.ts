// One `new Worker()` gets one of two embedded files, chosen at run time.
import w1 from "./w1.ts" with { type: "file" };
import w2 from "./w2.ts" with { type: "file" };
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
for (const n of [0, 1, 0]) console.log(await ask(new Worker(n ? w1 : w2), "n" + n));
