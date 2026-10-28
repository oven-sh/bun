import { Worker as NodeWorker, parentPort } from "node:worker_threads";

const ways: Record<string, () => void> = {
  "while its entry runs": () => {
    parentPort!.postMessage("terminate me");
    for (;;) {}
  },
  "while its entry sleeps": () => {
    parentPort!.postMessage("terminate me");
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
  },
  "behind its entry": () => {
    parentPort!.on("message", () => {});
    setTimeout(() => parentPort!.postMessage("terminate me"), 20);
  },
};

if (Bun.isMainThread) {
  for (const way of Object.keys(ways)) {
    const env = { ...process.env, WAY: way };
    const ofTheWeb = new Worker(new URL(import.meta.url), { env } as any);
    ofTheWeb.onmessage = () => ofTheWeb.terminate();
    ofTheWeb.onerror = event => console.log("error", event.message);
    console.log("of the web,", way + ":", await new Promise(resolve => ofTheWeb.addEventListener("close", event => resolve((event as any).code))));

    const ofNode = new NodeWorker(new URL(import.meta.url), { env });
    ofNode.on("message", () => ofNode.terminate());
    ofNode.on("error", error => console.log("error", String(error)));
    console.log("of node,", way + ":", await new Promise(resolve => ofNode.on("exit", resolve)));
  }
} else {
  ways[process.env.WAY!]();
}
