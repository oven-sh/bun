// Tests that the built-in fetch() and WebSocket clients publish the
// undici-compatible diagnostics_channel events that APM tooling (dd-trace,
// @opentelemetry/instrumentation-undici) subscribes to.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

const fetchFixture = /* js */ `
import dc from "node:diagnostics_channel";
const names = [
  "undici:request:create", "undici:request:bodySent", "undici:request:headers",
  "undici:request:trailers", "undici:request:error",
  "undici:client:beforeConnect", "undici:client:connected",
  "undici:client:sendHeaders",
];
const fired = Object.create(null);
for (const n of names) dc.subscribe(n, m => (fired[n] ??= []).push(m));

// APM instrumentations inject propagation headers during undici:request:create
let addHeaderRejected = 0, validated = false;
dc.subscribe("undici:request:create", ({ request }) => {
  request.addHeader("traceparent", "00-abc-def-01");
  if (validated) return;
  validated = true;
  // addHeader must reject names/values that would bypass header validation.
  for (const [k, v] of [["", "v"], ["bad name", "v"], ["x", "a\\r\\nX-Injected: 1"],
                        ["x", "\\x01"], ["x", "\\x7f"], ["x", "\\u0100"]]) {
    try { request.addHeader(k, v); } catch { addHeaderRejected++; }
  }
  request.addHeader("x-tab", "a\\tb"); // TAB is allowed
});

let gotTraceparent;
await using srv = Bun.serve({
  port: 0,
  fetch: (req) => { gotTraceparent = req.headers.get("traceparent"); return new Response("ok"); },
});
const res = await fetch("http://127.0.0.1:" + srv.port + "/p?q=1", { headers: { "x-custom": "1" } });
await res.text();

// URL userinfo must not leak into request.origin
await fetch("http://user:secret@127.0.0.1:" + srv.port + "/cred").then(r => r.text());
const credOrigin = fired["undici:request:create"][1].request.origin;
const trailersCountOk = (fired["undici:request:trailers"] ?? []).length;

// error path: trailers must NOT fire, only error
let errRequest;
dc.subscribe("undici:request:error", ({ request }) => { errRequest = request; });
using errSrv = Bun.listen({ port: 0, hostname: "127.0.0.1", socket: { open(s) { s.end(); }, data() {} } });
try { await fetch("http://127.0.0.1:" + errSrv.port + "/"); } catch {}

const create = fired["undici:request:create"][0];
const headers = fired["undici:request:headers"][0];
const trailers = fired["undici:request:trailers"][0];
const connected = fired["undici:client:connected"][0];
const sendHeaders = fired["undici:client:sendHeaders"][0];

process.stdout.write(JSON.stringify({
  gotTraceparent,
  create: { origin: create.request.origin, method: create.request.method, path: create.request.path,
            headersIsArray: Array.isArray(create.request.headers),
            hasAddHeader: typeof create.request.addHeader === "function",
            hasCustom: create.request.headers.includes("x-custom") },
  sameInstance: create.request === headers.request && headers.request === trailers.request,
  headers: { statusCode: headers.response.statusCode, keys: Object.keys(headers).sort(),
             headersIsArray: Array.isArray(headers.response.headers) },
  trailers: { completed: trailers.request.completed, keys: Object.keys(trailers).sort() },
  beforeConnect: Object.keys(fired["undici:client:beforeConnect"][0]).sort(),
  connected: { keys: Object.keys(connected).sort(), hostname: connected.connectParams.hostname,
               protocol: connected.connectParams.protocol },
  sendHeaders: { keys: Object.keys(sendHeaders).sort(), hasRequestLine: sendHeaders.headers.startsWith("GET /p?q=1 HTTP/1.1") },
  bodySent: !!fired["undici:request:bodySent"],
  errorFired: fired["undici:request:error"]?.length > 0 && errRequest?.aborted === true && errRequest?.completed === false,
  errorIsError: fired["undici:request:error"]?.[0]?.error instanceof Error,
  trailersOnErrorPath: (fired["undici:request:trailers"] ?? []).length - trailersCountOk,
  addHeaderRejected,
  credOriginHasUserinfo: credOrigin.includes("@") || credOrigin.includes("secret"),
}));
`;

describe("fetch()", () => {
  test("publishes undici:* diagnostics_channel events", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fetchFixture],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const out = JSON.parse(stdout);

    expect(out.gotTraceparent).toBe("00-abc-def-01");
    expect(out.create).toEqual({
      origin: expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+$/),
      method: "GET",
      path: "/p?q=1",
      headersIsArray: true,
      hasAddHeader: true,
      hasCustom: true,
    });
    expect(out.sameInstance).toBe(true);
    expect(out.headers.statusCode).toBe(200);
    expect(out.headers.keys).toEqual(["request", "response"]);
    expect(out.headers.headersIsArray).toBe(true);
    expect(out.trailers.completed).toBe(true);
    expect(out.trailers.keys).toEqual(["request", "trailers"]);
    expect(out.beforeConnect).toEqual(["connectParams", "connector"]);
    expect(out.connected.keys).toEqual(["connectParams", "connector", "socket"]);
    expect(out.connected.hostname).toBe("127.0.0.1");
    expect(out.connected.protocol).toBe("http:");
    expect(out.sendHeaders.keys).toEqual(["headers", "request", "socket"]);
    expect(out.sendHeaders.hasRequestLine).toBe(true);
    expect(out.bodySent).toBe(true);
    expect(out.errorFired).toBe(true);
    expect(out.errorIsError).toBe(true);
    expect(out.trailersOnErrorPath).toBe(0);
    expect(out.addHeaderRejected).toBe(6);
    expect(out.credOriginHasUserinfo).toBe(false);

    expect(exitCode).toBe(0);
  });

  test("does not publish when no undici:* channel is subscribed", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        /* js */ `
          import dc from "node:diagnostics_channel";
          let n = 0;
          // subscribing to a non-undici channel must not enable the bridge
          dc.subscribe("other:thing", () => n++);
          await using srv = Bun.serve({ port: 0, fetch: () => new Response("ok") });
          await fetch("http://127.0.0.1:" + srv.port).then(r => r.text());
          // after the fact, the channel had no subscriber so nothing was published
          let fired = false;
          dc.subscribe("undici:request:create", () => { fired = true; });
          // new fetch after subscribing should fire
          await fetch("http://127.0.0.1:" + srv.port).then(r => r.text());
          process.stdout.write(JSON.stringify({ other: n, fired }));
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({ other: 0, fired: true });
    expect(exitCode).toBe(0);
  });
});

describe("WebSocket", () => {
  test("publishes undici:websocket:* diagnostics_channel events", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        /* js */ `
          import dc from "node:diagnostics_channel";
          const names = ["undici:websocket:open", "undici:websocket:close",
                         "undici:websocket:socket_error", "undici:websocket:ping", "undici:websocket:pong"];
          const fired = Object.create(null);
          for (const n of names) dc.subscribe(n, m => (fired[n] ??= []).push(m));

          await using srv = Bun.serve({
            port: 0,
            fetch: (req, server) => { if (server.upgrade(req)) return; return new Response("no"); },
            websocket: {
              open(ws) { ws.ping(Buffer.from("hi")); },
              message(ws, m) { ws.close(1000, "bye"); },
            },
          });

          const ws = new WebSocket("ws://127.0.0.1:" + srv.port);
          await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
          ws.send("x");
          await new Promise(r => { ws.onclose = r; });

          // connection-level failure: TCP server that closes before WS handshake
          using errSrv = Bun.listen({ port: 0, hostname: "127.0.0.1", socket: { open(s) { s.end(); }, data() {} } });
          const ws2 = new WebSocket("ws://127.0.0.1:" + errSrv.port + "/nope");
          await new Promise(r => { ws2.onclose = r; ws2.onerror = () => {}; });

          const open = fired["undici:websocket:open"]?.[0];
          const close = fired["undici:websocket:close"]?.[0];
          process.stdout.write(JSON.stringify({
            open: open ? { keys: Object.keys(open).sort(), protocol: open.protocol } : null,
            close: close ? { keys: Object.keys(close).sort(), code: close.code, reason: close.reason } : null,
            ping: fired["undici:websocket:ping"]?.length > 0,
            error: fired["undici:websocket:socket_error"]?.length > 0,
            errorIsError: fired["undici:websocket:socket_error"]?.[0] instanceof Error,
          }));
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    const out = JSON.parse(stdout);
    expect(out.open.keys).toEqual(["address", "extensions", "protocol", "websocket"]);
    expect(out.open.protocol).toBe("");
    expect(out.close.keys).toEqual(["code", "reason", "websocket"]);
    expect(out.close.code).toBe(1000);
    expect(out.close.reason).toBe("bye");
    expect(out.ping).toBe(true);
    expect(out.error).toBe(true);
    expect(out.errorIsError).toBe(true);
    expect(exitCode).toBe(0);
  });
});
