import { app, Text, Window } from "bun:appkit";
import { emit, run } from "./_util";

await run(async () => {
  app.activationPolicy = "accessory";

  const win = new Window({ title: "loop", width: 200, height: 100, content: new Text({ text: "waiting" }) });
  win.show();

  const t0 = performance.now();
  await new Promise<void>(resolve => setTimeout(resolve, 20));
  emit({ step: "timer", elapsed: performance.now() - t0 });

  using server = Bun.serve({ port: 0, fetch: () => new Response("served") });
  const res = await fetch(server.url);
  emit({ step: "fetch", body: await res.text(), status: res.status });

  const worker = new Worker(new URL("./_worker.ts", import.meta.url).href);
  const message = await new Promise<unknown>((resolve, reject) => {
    worker.onmessage = e => resolve(e.data);
    worker.onerror = e => reject(e);
  });
  worker.terminate();
  emit({ step: "worker", message });

  const child = Bun.spawn({ cmd: [process.execPath, "-e", "console.log('child')"], stdout: "pipe", env: process.env });
  emit({ step: "spawn", stdout: (await child.stdout.text()).trim(), exitCode: await child.exited });

  win.close();
});
