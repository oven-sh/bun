// ws.close() and ws.terminate() must not fire the close event synchronously.
// Per the WHATWG WebSocket spec, when the connection is closed the user agent
// must *queue a task* to set readyState to CLOSED and fire the close event.
// Bun was calling dispatchEvent() directly from inside close()/terminate()
// (via Rust dispatch_close/dispatch_abrupt_close -> C++ didClose/
// didReceiveClose), so a close-promise created on the line after .close()
// never resolved because onclose had already run.
//
// https://github.com/oven-sh/bun/issues/15665

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

function upgradeServer() {
  return Bun.serve({
    port: 0,
    fetch(req, server) {
      if (server.upgrade(req)) return;
      return new Response("upgrade failed", { status: 500 });
    },
    websocket: { message() {} },
  });
}

async function open(server: ReturnType<typeof upgradeServer>) {
  const ws = new WebSocket(`ws://127.0.0.1:${server.port}/`);
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error("WebSocket failed to connect"));
  });
  ws.onopen = ws.onerror = null;
  return ws;
}

describe.concurrent.each(["close", "terminate"] as const)("ws.%s() while OPEN", method => {
  test("does not fire onclose synchronously", async () => {
    await using server = upgradeServer();
    const ws = await open(server);

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

  // m_connectedWebSocketKind is cleared synchronously but m_state only moves
  // to CLOSED in the queued task; m_state = CLOSING in between routes send()
  // to its CLOSING branch instead of RELEASE_ASSERT_NOT_REACHED.
  test("send() between the call and the close event does not crash", async () => {
    await using server = upgradeServer();
    const ws = await open(server);

    const closed = new Promise<void>(resolve => (ws.onclose = () => resolve()));
    if (method === "close") ws.close(3000);
    else ws.terminate();

    expect(ws.readyState).toBe(WebSocket.CLOSING);
    ws.send("after");
    ws.send(new Uint8Array([1, 2, 3]));
    // @ts-ignore - Bun extension
    ws.ping?.("p");
    expect(ws.bufferedAmount).toBeGreaterThan(0);

    await closed;
    expect(ws.readyState).toBe(WebSocket.CLOSED);
  });
});

// The original report: a promise whose resolver is captured *after* .close()
// must still resolve, because onclose is queued as a task and therefore
// observes the assignment made on the next line. Before the fix the process
// hung at 100% CPU awaiting a promise that could no longer resolve.
test.concurrent("issue #15665 repro: promise created after close() resolves", async () => {
  const script = /* js */ `
    const server = Bun.serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) return;
        return new Response("upgrade failed", { status: 500 });
      },
      websocket: { message(ws, msg) { ws.send(msg); } },
    });

    // Watchdog so a regression exits instead of hanging the gate's
    // fail-before run.
    const watchdog = setTimeout(() => {
      console.error("timed out waiting for close");
      process.exit(2);
    }, 3000);

    let resolve;
    const ws = new WebSocket("ws://127.0.0.1:" + server.port);

    const { promise: openPromise, resolve: openResolve } = Promise.withResolvers();
    ws.onopen = () => openResolve();
    ws.onclose = (e) => { console.log("Close:", e.code); resolve?.(); };

    await openPromise;
    ws.close(3000);

    const closePromise = new Promise(r => (resolve = r));
    await closePromise;

    console.log("done");
    clearTimeout(watchdog);
    server.stop(true);
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
