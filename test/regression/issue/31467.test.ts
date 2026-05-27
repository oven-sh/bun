import { expect, test } from "bun:test";
import { connect } from "node:net";

// https://github.com/oven-sh/bun/issues/31467
//
// Segfault in `uWS::HttpContext<false>::onClose` during socket teardown. A
// socket closed while the event loop was mid-dispatch could still be referenced
// by a stale `ready_polls` entry and be dispatched again, reading its
// destructed `HttpResponseData` ext (a dangling `onAborted`) and crashing with
// no application JS frames on the stack.
//
// Reproduction: an HTTP server (async handler on Bun.serve) serving back-to-back
// POSTs over keep-alive with connections resetting mid-flight, which drives the
// socket close/teardown path (`us_internal_socket_close_raw` -> `onClose`)
// concurrently with active dispatch of other sockets. Under the ASAN debug build
// a use-after-free there aborts the process; the server must stay up and answer.
test("Bun.serve keep-alive back-to-back POSTs with mid-flight resets don't crash onClose", async () => {
  const body = Buffer.alloc(256, "x").toString();
  const keepAliveReq =
    `POST / HTTP/1.1\r\nHost: x\r\nConnection: keep-alive\r\n` + `Content-Length: ${body.length}\r\n\r\n${body}`;

  await using server = Bun.serve({
    port: 0,
    idleTimeout: 1,
    async fetch(req) {
      await req.text();
      await Promise.resolve();
      return new Response("ok");
    },
  });

  const { promise: finished, resolve: finish } = Promise.withResolvers<void>();
  const deadline = Date.now() + 1500;
  let open = 0;
  let responses = 0;

  const spawnConn = () => {
    if (Date.now() > deadline) {
      if (open === 0) finish();
      return;
    }
    open++;
    const sock = connect(server.port, "127.0.0.1");
    sock.setNoDelay(true);
    let reqs = 0;
    const respawn = () => {
      open--;
      if (Date.now() <= deadline) queueMicrotask(spawnConn);
      else if (open === 0) finish();
    };
    sock.on("connect", () => {
      // Pipeline two POSTs back-to-back over keep-alive.
      sock.write(keepAliveReq + keepAliveReq);
    });
    sock.on("data", chunk => {
      responses += (String(chunk).match(/HTTP\/1\.1 200/g) ?? []).length;
      if (Date.now() > deadline) return sock.destroy();
      // Abruptly reset a fraction of connections mid-conversation.
      if (Math.random() < 0.25) return sock.destroy();
      if (++reqs > 8) return sock.end();
      sock.write(keepAliveReq);
    });
    sock.on("close", respawn);
    sock.on("error", () => {});
  };

  for (let i = 0; i < 64; i++) spawnConn();
  await finished;

  // Server must still be alive and answering after all that teardown churn.
  const res = await fetch(server.url, { method: "POST", body: "ping" });
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("ok");
  expect(responses).toBeGreaterThan(0);
});
