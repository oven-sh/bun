// JavaScript that AppKit runs from inside its event wait (a display timer,
// an Apple Event; here a run-loop timer armed through the test hook) can arm
// Bun timers and immediates and they fire on time, and a synchronous wait on
// Bun's loop from in there polls the kqueue instead of pumping AppKit again.
import { app, Button, Window } from "bun:appkit";
import { appKitInternals } from "bun:internal-for-testing";
import { expect } from "bun:test";
import { emit, run } from "./_util";

await run(async () => {
  app.activationPolicy = "accessory";
  let clicks = 0;
  const button = new Button({ title: "b", onClick: () => clicks++ });
  const win = new Window({ title: "wait", width: 200, height: 100, content: button });
  win.show();

  // Nothing but a far-off timer is pending when the callback runs, so the
  // wait was armed for seconds away; the 10 ms timer it arms must still fire
  // promptly, and so must the immediate.
  await new Promise<void>(done => {
    const far = setTimeout(() => {}, 30_000);
    appKitInternals.runInsideWait(20, () => {
      const armed = performance.now();
      let immediate = false;
      setImmediate(() => (immediate = true));
      setTimeout(() => {
        clearTimeout(far);
        emit({ step: "inside-wait", timerMs: performance.now() - armed, immediate });
        done();
      }, 10);
    });
  });

  // A synchronous wait on a promise from inside AppKit's callout: the timer
  // it depends on fires (the loop was serviced), a click queued meanwhile is
  // not dispatched re-entrantly, and control comes back.
  await new Promise<void>(done => {
    appKitInternals.runInsideWait(5, () => {
      const before = clicks;
      button.click();
      const during0 = clicks;
      let resolved: unknown = "pending";
      try {
        expect(new Promise(r => setTimeout(() => r(1), 30))).resolves.toBe(1);
        resolved = 1;
      } catch (e) {
        resolved = String((e as Error)?.message);
      }
      emit({ step: "sync-wait", before, during0, resolved, after: clicks });
      done();
    });
  });

  win.close();
});
