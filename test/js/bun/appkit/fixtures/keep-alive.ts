import { app, Text, Window } from "bun:appkit";
import { emit, run } from "./_util";

await run(async () => {
  app.activationPolicy = "accessory";
  app.keepAlive = true;
  emit({ step: "started", running: app.isRunning });

  const win = new Window({ width: 200, height: 100, content: new Text({ text: "keepAlive" }) });
  win.show();
  win.close();
  emit({ step: "closed", closed: win.closed, windows: Array.from(app.windows).length, keepAlive: app.keepAlive });

  // Unref'd: only app.keepAlive holds the process open long enough for this to fire.
  setTimeout(() => {
    emit({ step: "still-alive" });
    app.keepAlive = false;
    // And now nothing does, so the process exits before this one fires.
    setTimeout(() => emit({ step: "unexpected-timer" }), 200).unref();
  }, 50).unref();
});
