// The Worker touches bun:appkit BEFORE the main thread does, so whichever
// thread loads the frameworks first cannot decide which thread counts as main.
import { app, Text, Window } from "bun:appkit";
import { emit, run } from "./_util";

const worker = new Worker(new URL("./_wrong-thread-worker.ts", import.meta.url).href);
const fromWorker = await new Promise<any>((resolve, reject) => {
  worker.onmessage = e => resolve(e.data);
  worker.onerror = e => reject(e);
});
worker.terminate();
emit({ step: "worker", ...fromWorker });

await run(() => {
  app.activationPolicy = "accessory";
  const win = new Window({ visible: false, content: new Text({ text: "main" }) });
  emit({ step: "main", windows: Array.from(app.windows).length });
  win.close();
});
