// A Worker made of a blob: URL, a data: URL, an object URL that was revoked, eval: true: code that is no file. Whatever the answer, it is an event or an error, and the main thread lives.
import { Worker as NodeWorker } from "node:worker_threads";
const source = `postMessage("ran " + (1 + 1)); `;
const start = (what: string, make: () => Worker) =>
  new Promise<void>(resolve => {
    let worker: Worker;
    try {
      worker = make();
    } catch (error) {
      console.log(what, "THROWS", (error as Error).name);
      return resolve();
    }
    const heard: string[] = [];
    worker.onmessage = event => heard.push(event.data);
    worker.onerror = event => (heard.push("error"), event.preventDefault());
    worker.addEventListener("close", event => (console.log(what + ":", heard.join(" | "), "| close", (event as any).code), resolve()));
  });
await start("a blob", () => new Worker(URL.createObjectURL(new Blob([source], { type: "application/javascript" }))));
await start("a blob of TypeScript", () => new Worker(URL.createObjectURL(new File([`const n: number = 2; postMessage("ran " + n);`], "w.ts", { type: "application/typescript" }))));
await start("a revoked blob", () => { const url = URL.createObjectURL(new Blob([source])); URL.revokeObjectURL(url); return new Worker(url); });
await start("a data URL", () => new Worker("data:text/javascript," + encodeURIComponent(source)));
await start("a data URL in base64", () => new Worker("data:text/javascript;base64," + btoa(source)));
await start("a blob with a syntax error", () => new Worker(URL.createObjectURL(new Blob(["this is no program"]))));
await new Promise<void>(resolve => {
  try {
    const worker = new NodeWorker(`require("node:worker_threads").parentPort.postMessage("ran")`, { eval: true });
    const heard: string[] = [];
    worker.on("message", (message: string) => heard.push(message));
    worker.on("error", () => heard.push("error"));
    worker.on("exit", (code: number) => (console.log("eval: true:", heard.join(" | "), "| exit", code), resolve()));
  } catch (error) {
    console.log("eval: true THROWS", (error as Error).name);
    resolve();
  }
});
console.log("the main thread lives");
