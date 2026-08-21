import { app, gpu, MetalView, Window } from "bun:appkit";
import { emit, run, tick } from "./_util";

await run(async () => {
  app.activationPolicy = "accessory";

  const frames: { time: number; dt: number; width: unknown; height: unknown; pass: string }[] = [];
  const view = new MetalView({
    width: 64,
    height: 64,
    clearColor: "#0000ff",
    running: false,
    onFrame(frame, info) {
      let pass = "ok";
      try {
        frame.renderPass(view).end();
      } catch (e) {
        pass = String((e as Error)?.message);
      }
      frames.push({ time: info.time, dt: info.dt, width: typeof info.width, height: typeof info.height, pass });
    },
  });
  const win = new Window({ title: "metal", width: 64, height: 64, content: view });
  win.show();
  emit({ step: "constructed", available: gpu.available, sameGpu: view.gpu === gpu, running: view.running });

  if (!gpu.available) {
    view.draw();
    await tick();
    emit({ step: "no-gpu", frames: frames.length, drawableSize: view.drawableSize });
    win.close();
    return emit({ step: "skip-no-gpu" });
  }

  view.draw();
  // performance.now() must advance between the two frames for `time` to grow.
  const t0 = performance.now();
  while (performance.now() === t0);
  view.draw();
  await tick();
  emit({
    step: "frames",
    count: frames.length,
    increasing: frames.length >= 2 && frames[1].time > frames[0].time,
    firstDt: frames[0]?.dt,
    types: frames.map(f => [typeof f.time, typeof f.dt, f.width, f.height]),
    passes: frames.map(f => f.pass),
    drawableSize: view.drawableSize,
  });

  view.onFrame = undefined;
  view.draw();
  await tick();
  emit({ step: "cleared", count: frames.length });

  win.close();
});
