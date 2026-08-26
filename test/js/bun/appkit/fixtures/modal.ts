// A modal session entered through the bridge, from top-level JavaScript and
// from JavaScript that AppKit runs inside Bun's wait (an NSTimer in the common
// modes): either way the process's timers resume once the session ends.
import { app, Text, Window } from "bun:appkit";
import { objc } from "bun:objc";
import { emit, run } from "./_util";

await run(async () => {
  app.activationPolicy = "accessory";
  const win = new Window({ title: "modal", width: 200, height: 100, visible: false, content: new Text({ text: "m" }) });
  const { NSApplication, NSTimer, NSRunLoop } = objc.classes;
  const NSApp = NSApplication.sharedApplication();
  /** A timer AppKit fires in every run-loop mode, a modal session's included. */
  const inCommonModes = (seconds: number, fn: () => void) => {
    const timer = NSTimer.timerWithTimeInterval_repeats_block_(seconds, false, fn);
    NSRunLoop.mainRunLoop().addTimer_forMode_(timer, objc.constants.NSRunLoopCommonModes);
  };
  // Ends the process if Bun's loop never resumes; does not depend on that loop.
  inCommonModes(8, () => {
    emit({ step: "watchdog" });
    process.exit(3);
  });

  // From top-level JavaScript: everything armed before waits for the session.
  {
    let timeoutDuring = false;
    setTimeout(() => (timeoutDuring = true), 10);
    inCommonModes(0.2, () => NSApp.stopModal());
    const response = NSApp.runModalForWindow_(win.native);
    const ranDuring = timeoutDuring;
    await new Promise<void>(resolve => setTimeout(resolve, 20));
    emit({ step: "top level", response, ranDuring, ranAfter: timeoutDuring });
  }

  // From inside the wait: the wake Bun posts is consumed by the session's
  // loop; a fresh one ends the wait after the session does.
  {
    let response: unknown;
    await new Promise<void>(resolve => {
      inCommonModes(0.05, () => {
        setTimeout(resolve, 10);
        inCommonModes(0.2, () => NSApp.stopModal());
        response = NSApp.runModalForWindow_(win.native);
      });
    });
    emit({ step: "inside wait", response });
  }

  win.close();
  emit({ step: "done" });
});
