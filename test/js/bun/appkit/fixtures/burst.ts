// UI events queued faster than the loop dispatches them: the pump sends at
// most EVENTS_PER_PARK (16) per park, so Bun's loop gets a turn between
// batches whether it is busy (immediates pending: the rate-limited drain)
// or idle (a timer pending: the wait ends as soon as events are queued, and
// the timer still fires on time once the queue is empty); and a wake event
// left over from an earlier park is skipped, not sent to the application.
// The events are application-defined ones with no window, which AppKit's
// sendEvent: takes and drops, so what is counted is the pump's dispatch.
import { Window, app } from "bun:appkit";
import { appKitInternals } from "bun:internal-for-testing";
import { objc } from "bun:objc";
import { emit, run, tick } from "./_util";

await run(async () => {
  app.activationPolicy = "accessory";
  const { NSApplication, NSEvent } = objc.classes;
  const win = new Window({ title: "burst", width: 200, height: 100 });
  win.show();
  await tick();
  const NSApp = NSApplication.sharedApplication();
  const post = (subtype: number, data: number) => {
    const event = NSEvent.otherEventWithType_location_modifierFlags_timestamp_windowNumber_context_subtype_data1_data2_(
      objc.enums.NSEventType.applicationDefined,
      { x: 0, y: 0 },
      0,
      0,
      0,
      null,
      subtype,
      data,
      0,
    );
    NSApp.postEvent_atStart_(event, false);
  };
  const stats = () => appKitInternals.runLoopStats();

  // Busy loop: an immediate is always pending, so every tick drains rather
  // than waits. The events dispatched from one immediate to the next come in
  // batches of at most EVENTS_PER_PARK, with a turn of Bun's loop between.
  {
    const before = stats();
    for (let i = 0; i < 40; i++) post(1, i);
    const batches: number[] = [];
    let seen = before.dispatched;
    const deadline = performance.now() + 5000;
    await new Promise<void>(done => {
      const spin = () => {
        const { dispatched } = stats();
        if (dispatched !== seen) {
          batches.push(dispatched - seen);
          seen = dispatched;
        }
        if (seen - before.dispatched >= 40 || performance.now() > deadline) return done();
        setImmediate(spin);
      };
      setImmediate(spin);
    });
    emit({ step: "busy", batches, dispatched: seen - before.dispatched });
  }

  // Idle loop: only a 30 ms timer is pending, so each tick waits in AppKit.
  // The queued events end each wait at once and go out 16 per wait; the
  // timer fires on time whether or not the queue is empty by then (16 sends
  // plus updateWindows may cost more than 30 ms on a slow machine), and what
  // is still queued goes out on the next waits; a stale wake event in the
  // queue (one of the pump's own, left from an earlier park) is dropped
  // without a dispatch; the sleeps hand this thread's heaps to the
  // allocator's scavenger, as the plain kqueue wait does, when the
  // environment has not turned the scavenger off (MIMALLOC_SCAVENGER=0 or a
  // purge delay of 0).
  {
    const off = (value: string | undefined) => /^(0|off|no|false)$/i.test(value ?? "");
    const scavenger = !off(process.env.MIMALLOC_SCAVENGER) && Number(process.env.MIMALLOC_PURGE_DELAY ?? 100) > 0;
    const before = stats();
    for (let i = 0; i < 40; i++) post(1, i);
    post(0x4275, 0);
    const armed = performance.now();
    await new Promise<void>(resolve => setTimeout(resolve, 30));
    const timerMs = performance.now() - armed;
    const atTimer = stats();
    // Whatever the timer beat is dispatched by the waits that follow it.
    let after = atTimer;
    const deadline = performance.now() + 2000;
    while (after.dispatched - before.dispatched < 40 && performance.now() < deadline) {
      await new Promise<void>(resolve => setTimeout(resolve, 1));
      after = stats();
    }
    emit({
      step: "idle",
      timerMs,
      waits: after.waits - before.waits,
      dispatched: after.dispatched - before.dispatched,
      byTimer: { waits: atTimer.waits - before.waits, dispatched: atTimer.dispatched - before.dispatched },
      staleWakes: after.staleWakes - before.staleWakes,
      handOffs: after.handOffs - before.handOffs,
      scavenger,
    });
  }

  win.close();
});
