// https://github.com/oven-sh/bun/pull/32233
// Subprocess pipe readers are one-shot (EPOLLONESHOT / EV_DISPATCH): if a poll
// callback re-enters the event loop while the outer ready-poll batch is still
// being dispatched, the batch's remaining (already-disarmed) events must not be
// dropped by the nested tick's wait, or their owners hang forever.
import { expect, test } from "bun:test";
import { isWindows } from "harness";

const N = 34;
const expected = Array.from({ length: N }, (_, i) => `out-${i}`);

// Windows readiness is driven by libuv, not this code path. Both macOS
// (kqueue, EV_DISPATCH) and Linux (epoll, EPOLLONESHOT) reproduce the hang.
test.skipIf(isWindows)("a batch of Bun.$ commands survives a nested tick from one command's continuation", async () => {
  let nested = false;

  const cmds = expected.map(out => {
    const cmd = Bun.$`printf %s ${out}`.quiet();
    // The first command to settle runs this continuation inline, during the
    // poll dispatch. Synchronously waiting on a promise (bun:test's .resolves
    // blocks via waitForPromise) forces a nested tick while the sibling
    // commands' one-shot pipe-EOF events are still in the outer batch.
    cmd.then(
      () => {
        if (!nested) {
          nested = true;
          expect(Bun.sleep(1)).resolves.toBe(undefined);
        }
      },
      () => {},
    );
    return cmd;
  });

  // Without the fix, the commands whose pipe-EOF event was dropped never
  // finish and this times out; nothing re-arms a disarmed one-shot pipe.
  const results = await Promise.all(cmds);

  expect(nested).toBe(true);
  expect(results.map(r => r.stdout.toString())).toEqual(expected);
});

// Same bug without bun:test as the trigger. The two tests above nest via
// expect().resolves, which blocks only as an implementation detail of the
// matcher. HTMLRewriter.transform with an async handler is *contractually*
// synchronous (it must wait for the handler's promise before returning), so
// this case keeps failing even if the matcher is ever made non-blocking.
test.skipIf(isWindows)(
  "a batch of Bun.$ commands survives a nested tick from an HTMLRewriter async handler",
  async () => {
    let nested = false;

    const cmds = expected.map(out => {
      const cmd = Bun.$`printf %s ${out}`.quiet();
      cmd.then(
        () => {
          if (!nested) {
            nested = true;
            new HTMLRewriter()
              .on("p", {
                async element() {
                  await Bun.sleep(1);
                },
              })
              .transform("<p>x</p>");
          }
        },
        () => {},
      );
      return cmd;
    });

    const results = await Promise.all(cmds);

    expect(nested).toBe(true);
    expect(results.map(r => r.stdout.toString())).toEqual(expected);
  },
);

// Same bug without the shell: the nested tick comes from a Bun.spawn onExit
// callback while sibling subprocesses' pipe-EOF events sit in the same batch.
test.skipIf(isWindows)("a batch of Bun.spawn pipe readers survives a nested tick from an onExit callback", async () => {
  let nested = false;

  const procs = expected.map(out =>
    Bun.spawn({
      cmd: ["printf", "%s", out],
      stdout: "pipe",
      stderr: "ignore",
      onExit() {
        if (!nested) {
          nested = true;
          expect(Bun.sleep(1)).resolves.toBe(undefined);
        }
      },
    }),
  );

  const outs = await Promise.all(procs.map(p => p.stdout.text()));
  await Promise.all(procs.map(p => p.exited));

  expect(nested).toBe(true);
  expect(outs).toEqual(expected);
});
