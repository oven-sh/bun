import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// When an HTMLRewriter document/element handler returns a promise, the
// rewriter blocks on waitForPromise() which drains the event loop. Any
// exception that surfaces while the event loop is being drained must be
// captured and surfaced as a transform() error instead of leaking as a
// pending VM exception into the host-function wrapper assertion.

test.each(["queueMicrotask", "setImmediate", "setTimeout"] as const)(
  "HTMLRewriter captures %s exceptions raised while waiting on a handler promise",
  schedule => {
    const rewriter = new HTMLRewriter();
    rewriter.onDocument({
      text: () => {
        const throwIt = () => {
          SharedArrayBuffer(1);
        };
        if (schedule === "queueMicrotask") queueMicrotask(throwIt);
        else if (schedule === "setImmediate") setImmediate(throwIt);
        else setTimeout(throwIt, 0);
        return new Promise(r => setImmediate(() => setImmediate(r)));
      },
    });
    expect(() => rewriter.transform("<div>hello</div>")).toThrow(
      "calling ArrayBuffer constructor without new is invalid",
    );
  },
);

test("HTMLRewriter captures unhandled rejections surfaced while waiting on a handler promise", () => {
  const rewriter = new HTMLRewriter();
  rewriter.onDocument({
    text: () => {
      new Promise(SharedArrayBuffer);
      return new Promise(r => setImmediate(r));
    },
  });
  expect(() => rewriter.transform("<div>hello</div>")).toThrow(
    "calling ArrayBuffer constructor without new is invalid",
  );
});

test("HTMLRewriter handler returning a rejected promise does not leave a pending exception", () => {
  const rewriter = new HTMLRewriter();
  rewriter.onDocument({
    text: () => new Promise(SharedArrayBuffer),
  });
  expect(() => rewriter.transform("<div>hello</div>")).toThrow();
});

test("console.takeHeapSnapshot propagates exceptions instead of aborting", async () => {
  const code = `
    globalThis.p = new Proxy({}, {
      getOwnPropertyDescriptor() { ArrayBuffer(); },
      get() { ArrayBuffer(); },
    });
    globalThis.child = Object.create(globalThis.p);
    console.takeHeapSnapshot();
    console.error("ok");
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", code],
    env: bunEnv,
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("ok");
  expect(exitCode).toBe(0);
});
