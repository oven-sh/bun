// The path of a file imported `with { type: "file" }` goes through an object and an array to `new Worker()`.
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
const table = { one: w1, list: [w2] };
console.log(await ask(new Worker(table.one), "a"), await ask(new Worker(table.list[0]), "b"));
