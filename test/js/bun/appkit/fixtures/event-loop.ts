import { app, Text, Window } from "bun:appkit";
import { emit, run, tick } from "./_util";

await run(async () => {
  app.activationPolicy = "accessory";

  const win = new Window({ title: "loop", width: 200, height: 100, content: new Text({ text: "waiting" }) });
  win.show();
  // The first show is a window-server round trip; measure once it is done.
  await tick();

  const t0 = performance.now();
  await new Promise<void>(resolve => setTimeout(resolve, 20));
  emit({ step: "timer", elapsed: performance.now() - t0 });

  // Idle with a window open: the loop parks inside AppKit instead of spinning.
  {
    const cpu0 = process.cpuUsage();
    const wall0 = performance.now();
    await new Promise<void>(resolve => setTimeout(resolve, 500));
    const cpu = process.cpuUsage(cpu0);
    emit({ step: "idle", wallMs: performance.now() - wall0, cpuMs: (cpu.user + cpu.system) / 1000 });
  }

  // A message from another thread wakes the parked loop by itself: no timer
  // and no server is pending on the main thread while it waits.
  {
    const worker = new Worker(new URL("./_worker.ts", import.meta.url).href);
    const next = () =>
      new Promise<unknown>((resolve, reject) => {
        worker.onmessage = e => resolve(e.data);
        worker.onerror = e => reject(e);
      });
    const message = await next();
    const rounds: number[] = [];
    for (let i = 0; i < 20; i++) {
      const sent = performance.now();
      const reply = next();
      worker.postMessage(i);
      await reply;
      rounds.push(performance.now() - sent);
    }
    worker.terminate();
    emit({ step: "worker", message, rounds: rounds.length, worstMs: Math.max(...rounds) });
  }

  using server = Bun.serve({ port: 0, fetch: () => new Response("served") });
  const res = await fetch(server.url);
  emit({ step: "fetch", body: await res.text(), status: res.status });

  const child = Bun.spawn({ cmd: [process.execPath, "-e", "console.log('child')"], stdout: "pipe", env: process.env });
  emit({ step: "spawn", stdout: (await child.stdout.text()).trim(), exitCode: await child.exited });

  win.close();
});
