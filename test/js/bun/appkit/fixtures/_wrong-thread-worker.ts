import { app, Text, Window } from "bun:appkit";

function attempt(f: () => unknown) {
  try {
    f();
    return { threw: false };
  } catch (e) {
    const err = e as Error & { code?: string };
    return { threw: true, code: err?.code ?? null, message: String(err?.message) };
  }
}

app.activationPolicy = "accessory";
postMessage({
  view: attempt(() => new Text({ text: "off-main" })),
  start: attempt(() => app.activate()),
  window: attempt(() => new Window({ visible: false })),
  keepAlive: attempt(() => (app.keepAlive = true)),
  // A refused start leaves nothing behind: not "running", not holding the worker open.
  running: app.isRunning,
  keptAlive: app.keepAlive,
});
