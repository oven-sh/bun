// Six embedded files; their paths are stored on globalThis and read back, so the build cannot tell which one a Worker gets.
import w1 from "./w1.ts" with { type: "file" };
import w2 from "./w2.ts" with { type: "file" };
import w3 from "./w3.ts" with { type: "file" };
import w4 from "./w4.ts" with { type: "file" };
import w5 from "./w5.ts" with { type: "file" };
import w6 from "./w6.ts" with { type: "file" };
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
const all = [w1, w2, w3, w4, w5, w6];
const hidden: any = globalThis;
hidden.paths = all;
for (let i = 0; i < 6; i++) console.log(await ask(new Worker(hidden.paths[i]), "i" + i));
