import { app, Text, Window } from "bun:appkit";
import { appKitInternals } from "bun:internal-for-testing";
import { emit, run } from "./_util";

// app.quit() and -[NSApplication terminate:] (Cmd-Q, the Dock's Quit, a
// logout) share one path: beforequit may veto, then every window is asked
// through shouldClose and closed, then the process exits with process.exitCode
// even though keepAlive or a timer would hold it open. app.quit() exits at the
// next turn of the loop; terminate: exits before it returns.
const mode = process.argv[2] ?? "windows";

await run(async () => {
  let windows: Window[] = [];
  const state = (step: string, extra: Record<string, unknown> = {}) =>
    emit({ step, closed: windows.map(w => w.closed), ...extra });
  process.on("beforeExit", () => emit({ step: "beforeExit" }));

  if (mode === "not-started") {
    // Nothing has started AppKit: quit() is process.exit(process.exitCode).
    setInterval(() => {}, 1000);
    process.on("exit", code => state("exit", { code, running: app.isRunning }));
    process.exitCode = 4;
    app.quit();
    state("after-quit");
    return;
  }

  if (mode === "no-windows") {
    app.activationPolicy = "accessory";
    app.keepAlive = true;
    setInterval(() => {}, 1000);
    // keepAlive alone started the application; nothing else has.
    process.on("exit", code => state("exit", { code, running: app.isRunning }));
    app.quit();
    state("after-quit");
    return;
  }

  app.activationPolicy = "accessory";
  if (mode !== "plain") {
    app.keepAlive = true;
    setInterval(() => {}, 1000);
  }

  let onClose = 0;
  let shouldCloseCalls = 0;
  const counted = { onClose: () => onClose++ };
  const main = new Window({
    title: "main",
    width: 200,
    height: 100,
    content: new Text({ text: "quit" }),
    ...counted,
  });
  const palette = new Window({ title: "palette", width: 100, height: 100, closable: false, ...counted });
  const hidden = new Window({ title: "hidden", width: 100, height: 100, visible: false, ...counted });
  windows = [main, palette, hidden];

  if (mode === "exit-in-shouldClose") {
    // process.exit() from inside a callback that AppKit is running.
    main.shouldClose = () => process.exit(7);
    app.quit();
    state("unreachable");
    return;
  }

  if (mode === "plain") {
    // Nothing but the windows holds the process; the quit still exits through
    // process.exit (no beforeExit) rather than by running out of work.
    process.on("exit", code => state("exit", { code, onClose }));
    process.exitCode = 5;
    app.quit();
    state("after-quit");
    return;
  }

  const prevent = (e: { preventDefault(): void }) => e.preventDefault();
  app.on("beforequit", prevent);
  app.quit();
  state("preventDefault");
  app.off("beforequit", prevent);

  const refuse = () => false;
  app.on("beforequit", refuse);
  app.quit();
  state("return-false");
  app.off("beforequit", refuse);

  // A listener that throws is reported but neither vetoes nor hides another
  // listener's veto, whichever order they run in.
  const uncaught: string[] = [];
  process.on("uncaughtException", e => uncaught.push((e as Error).message));
  const boom = () => {
    throw new Error("listener boom");
  };
  app.on("beforequit", prevent);
  app.on("beforequit", boom);
  app.quit();
  state("prevent-then-throw", { uncaught: uncaught.splice(0) });
  app.off("beforequit", prevent);
  app.off("beforequit", boom);
  app.on("beforequit", boom);
  app.on("beforequit", prevent);
  app.quit();
  state("throw-then-prevent", { uncaught: uncaught.splice(0) });
  app.off("beforequit", boom);
  app.off("beforequit", prevent);

  // shouldClose false on the second window: the first has closed, the rest are not asked.
  const order: string[] = [];
  main.shouldClose = () => (order.push("main"), true);
  palette.shouldClose = () => (order.push("palette"), shouldCloseCalls++, false);
  hidden.shouldClose = () => (order.push("hidden"), true);
  app.quit();
  state("shouldClose-false", { onClose, shouldCloseCalls, order });
  palette.shouldClose = null;
  hidden.shouldClose = null;

  // Once a quit is accepted a second request neither re-runs beforequit nor
  // lets a late veto keep the process.
  let lateCalls = 0;
  const late = (e: { preventDefault(): void }) => {
    lateCalls++;
    e.preventDefault();
  };
  app.on("beforequit", boom);
  process.on("exit", code => state("exit", { code, onClose, shouldCloseCalls, lateCalls, uncaught }));
  process.exitCode = 3;
  if (mode === "terminate") {
    appKitInternals.terminate();
    state("unreachable");
    return;
  }
  app.quit();
  app.off("beforequit", boom);
  app.on("beforequit", late);
  app.quit();
  state("after-quit", { lateCalls });
});
