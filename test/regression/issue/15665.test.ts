// https://github.com/oven-sh/bun/issues/15665
//
// ws.close() and ws.terminate() must not fire the close event
// synchronously. Per the WHATWG WebSocket spec, when the connection is
// closed the user agent must *queue a task* to set readyState to CLOSED
// and fire the close event. Bun was calling dispatchEvent() directly from
// inside close()/terminate() (via Zig → C++ didClose/didReceiveClose),
// so a close-promise created on the line after .close() never resolved
// because onclose had already run.

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe.each(["close", "terminate"] as const)("ws.%s() while OPEN", method => {
  test("does not fire onclose synchronously", async () => {
    await using server = Bun.serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response("upgrade failed", { status: 500 });
      },
      websocket: { message() {} },
    });

    const ws = new WebSocket(server.url.href.replace("http", "ws"));
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = reject;
    });

    const order: string[] = [];
    let closeEvent: CloseEvent | undefined;
    const closed = new Promise<void>(resolve => {
      ws.onclose = e => {
        order.push("onclose");
        closeEvent = e;
        resolve();
      };
    });

    if (method === "close") ws.close(3000, "bye");
    else ws.terminate();
    order.push("after-" + method);

    // Spec: readyState is CLOSING until the queued task runs.
    expect(ws.readyState).toBe(WebSocket.CLOSING);

    await closed;

    expect(order).toEqual(["after-" + method, "onclose"]);
    expect(ws.readyState).toBe(WebSocket.CLOSED);
    if (method === "close") {
      expect({ code: closeEvent!.code, reason: closeEvent!.reason }).toEqual({
        code: 3000,
        reason: "bye",
      });
    }
  });
});

// The original report: a promise whose resolver is captured *after*
// .close() must still resolve, because onclose is queued as a task and
// therefore observes the assignment made on the next line.
test("issue #15665 repro: promise created after close() resolves", async () => {
  const script = /* js */ `
    const server = Bun.serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response("upgrade failed", { status: 500 });
      },
      websocket: { message(ws, msg) { ws.send(msg); } },
    });

    let resolve;
    const ws = new WebSocket("ws://localhost:" + server.port);

    const { promise: openPromise, resolve: openResolve } = Promise.withResolvers();
    ws.onopen = () => openResolve();
    ws.onclose = (e) => { console.log("Close:", e.code); resolve?.(); };

    await openPromise;
    ws.close(3000);

    // Before the fix, onclose already ran above while resolve was undefined,
    // so this promise never resolved and the process hung.
    const closePromise = new Promise(r => (resolve = r));
    await closePromise;

    console.log("done");
    server.stop();
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stderr).toBe("");
  expect(stdout).toBe("Close: 3000\ndone\n");
  expect(exitCode).toBe(0);
});
