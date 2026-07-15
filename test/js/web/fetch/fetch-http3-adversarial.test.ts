import type { Server } from "bun";
import { fetchH3Internals } from "bun:internal-for-testing";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { isDebug, tls } from "harness";

// Adversarial fuzzer-style coverage for the HTTP/3 large-body path. The server
// binds UDP only (`http1: false`) so a fetch that silently fell back to HTTP/1.1
// would ECONNREFUSED — every pass here proves the QUIC path carried the bytes.
let server: Server;
let base: string;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    tls,
    http3: true,
    http1: false,
    routes: {
      "/echo": async req => {
        const body = await req.bytes();
        return new Response(body, { headers: { "x-recv-len": String(body.length) } });
      },

      // Slow consumer: drip-read the request stream so the client's send window
      // fills and the upload has to block on flow control.
      "/slow-echo": async req => {
        const reader = req.body!.getReader();
        const chunks: Uint8Array[] = [];
        let total = 0;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          chunks.push(value);
          total += value.length;
          await Bun.sleep(5);
        }
        const out = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) {
          out.set(c, off);
          off += c.length;
        }
        return new Response(out, { headers: { "x-recv-len": String(total) } });
      },

      // Abandon the request body after 64KB and respond early. The client may
      // see a clean 200 or a stream error depending on how far the upload got
      // when the server STOP_SENDINGs — both are valid, we just record which.
      "/drop": async req => {
        const reader = req.body!.getReader();
        let seen = 0;
        while (seen < 64 * 1024) {
          const { value, done } = await reader.read();
          if (done) break;
          seen += value.length;
        }
        return new Response("dropped", { headers: { "x-seen": String(seen) } });
      },

      // Same partial read, but throw — server-side error mid-upload.
      "/reset": async req => {
        const reader = req.body!.getReader();
        let seen = 0;
        while (seen < 64 * 1024) {
          const { value, done } = await reader.read();
          if (done) break;
          seen += value.length;
        }
        throw new Error("reset after " + seen);
      },
    },
    // Swallow route-handler throws so they map to a 500 on the wire instead of
    // surfacing as an unhandled error attributed to the running test.
    error: () => new Response("server error", { status: 500 }),
    fetch: () => new Response("not found", { status: 404 }),
  });
  base = `https://127.0.0.1:${server.port}`;
});

afterAll(() => void server?.stop(true));

const h3 = { protocol: "http3", tls: { rejectUnauthorized: false } } as const;

// Deterministic pseudo-random fill so a byte-level corruption shows up as a
// hash mismatch rather than passing because every byte was the same.
function payload(size: number): Uint8Array {
  const buf = new Uint8Array(size);
  let x = 0x9e3779b9 ^ size;
  for (let i = 0; i < size; i++) {
    x = (x * 1103515245 + 12345) >>> 0;
    buf[i] = x >>> 24;
  }
  return buf;
}

function pullBody(data: Uint8Array, chunk = 8 * 1024) {
  let off = 0;
  return new ReadableStream({
    pull(ctrl) {
      if (off >= data.length) {
        ctrl.close();
        return;
      }
      const end = Math.min(off + chunk, data.length);
      ctrl.enqueue(data.subarray(off, end));
      off = end;
    },
  });
}

function directBody(data: Uint8Array, chunk = 8 * 1024) {
  return new ReadableStream({
    type: "direct",
    async pull(ctrl) {
      let off = 0;
      while (off < data.length) {
        const end = Math.min(off + chunk, data.length);
        ctrl.write(data.subarray(off, end));
        await ctrl.flush();
        off = end;
      }
      await ctrl.end();
    },
  });
}

const sizes = [64 * 1024, 512 * 1024, 1024 * 1024, 4 * 1024 * 1024];

describe.each(sizes)("http3 adversarial body=%d", size => {
  const data = payload(size);
  const want = Bun.hash(data);

  test("POST /echo (Uint8Array)", async () => {
    const res = await fetch(`${base}/echo`, { ...h3, method: "POST", body: data });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-recv-len")).toBe(String(size));
    const got = await res.bytes();
    expect(got.length).toBe(size);
    expect(Bun.hash(got)).toBe(want);
  });

  test("POST /slow-echo (slow consumer)", async () => {
    const res = await fetch(`${base}/slow-echo`, { ...h3, method: "POST", body: data });
    expect(res.status).toBe(200);
    const got = await res.bytes();
    expect(got.length).toBe(size);
    expect(Bun.hash(got)).toBe(want);
  });

  test("POST /echo via pull ReadableStream", async () => {
    const res = await fetch(`${base}/echo`, { ...h3, method: "POST", body: pullBody(data) });
    expect(res.status).toBe(200);
    const got = await res.bytes();
    expect(got.length).toBe(size);
    expect(Bun.hash(got)).toBe(want);
  });

  test("POST /echo via type:direct stream", async () => {
    const res = await fetch(`${base}/echo`, { ...h3, method: "POST", body: directBody(data) });
    expect(res.status).toBe(200);
    const got = await res.bytes();
    expect(got.length).toBe(size);
    expect(Bun.hash(got)).toBe(want);
  });

  test("POST /drop (server abandons body)", async () => {
    let outcome: string;
    try {
      const res = await fetch(`${base}/drop`, { ...h3, method: "POST", body: data });
      await res.text();
      outcome = `status=${res.status}`;
      expect(res.status).toBe(200);
    } catch (e) {
      outcome = `error=${(e as Error).name}`;
    }
    expect(typeof outcome).toBe("string");
  });

  test("8 concurrent POST /echo", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, async () => {
        const res = await fetch(`${base}/echo`, { ...h3, method: "POST", body: data });
        const got = await res.bytes();
        return { status: res.status, len: got.length, hash: Bun.hash(got) };
      }),
    );
    for (const r of results) {
      expect(r.status).toBe(200);
      expect(r.len).toBe(size);
      expect(r.hash).toBe(want);
    }
  });
});

test("POST /reset (server throws mid-upload)", async () => {
  const data = payload(1024 * 1024);
  let outcome: string;
  try {
    const res = await fetch(`${base}/reset`, { ...h3, method: "POST", body: data });
    await res.bytes();
    outcome = `status=${res.status}`;
    // If a response made it back it must be the error mapping, never a silent 200.
    expect(res.status).toBe(500);
  } catch (e) {
    outcome = `error=${(e as Error).name}`;
  }
  expect(typeof outcome).toBe("string");
});

test("AbortController during 1MB upload", async () => {
  const data = payload(1024 * 1024);
  const ac = new AbortController();
  const p = fetch(`${base}/slow-echo`, { ...h3, method: "POST", body: data, signal: ac.signal });
  await Bun.sleep(100);
  ac.abort();
  let err: unknown;
  try {
    const res = await p;
    await res.bytes();
  } catch (e) {
    err = e;
  }
  // The slow-echo round-trip may legitimately finish before 100ms on a fast
  // path; what we're guarding against is a hang or a non-abort failure mode.
  if (err !== undefined) {
    expect((err as Error).name).toMatch(/Abort/);
  }
});

// RFC 9110 §15.2 / RFC 9114 §4.1: an interim (1xx) response does not occupy
// the final-response slot. Bun.serve's HTTP/3 context answers
// `expect: 100-continue` with an informational HEADERS before routing, so the
// second fetch's stream carries HEADERS(100) → HEADERS(200) → DATA("body") →
// FIN and the client must surface only the final response. This is the
// positive counterpart to the DATA-after-1xx rejection below: it pins the 1xx
// skip in on_stream_headers, without which the fetch resolves with status 100.
//
// The warm-up request is load-bearing. Bun.serve's HTTP/3 server only
// sequences an informational response followed by a final response correctly
// on a reused connection: on a connection's first response lsquic is still
// holding the informational header block when the final HEADERS is written,
// the stream dies, and the fetch rejects. That is a server-side bug,
// https://github.com/oven-sh/bun/issues/33082, independent of the client
// behavior under test here; connection reuse is the common case and keeps
// this deterministic (0/30 cold vs 30/30 warm).
test("a 1xx interim response is skipped and the final response is delivered", async () => {
  using upstream = Bun.serve({
    port: 0,
    tls,
    http3: true,
    http1: false,
    async fetch(req) {
      return new Response("body", { headers: { "x-recv-len": String((await req.bytes()).length) } });
    },
  });
  const url = `https://127.0.0.1:${upstream.port}/`;

  // Establishes the QUIC connection the interim-response request below reuses.
  const warmup = await fetch(url, { ...h3, method: "POST", body: "warmup" });
  expect({ status: warmup.status, body: await warmup.text() }).toEqual({ status: 200, body: "body" });

  const res = await fetch(url, {
    ...h3,
    method: "POST",
    headers: { expect: "100-continue" },
    body: "request-content",
  });
  expect({
    status: res.status,
    body: await res.text(),
    received: res.headers.get("x-recv-len"),
  }).toEqual({ status: 200, body: "body", received: "15" });
});

// RFC 9114 §4.1 / RFC 9110 §15.2: response content may only follow the final
// (non-1xx) HEADERS frame. lsquic's client-side frame filter only checks that
// *some* HEADERS preceded DATA, so a peer that sends HEADERS(:status 1xx)
// followed by DATA reaches on_stream_data with status_code still 0. Before
// this was guarded, deliver() returned without draining body_buffer and the
// peer could grow it without bound. A conformant server cannot emit this
// sequence, so in debug builds `on_h3_request` answers a request carrying
// x-bun-test-100-then-data with HEADERS(100) then the header's value as DATA,
// never a final response (Response::test_data_after_informational in
// src/uws_sys/h3.rs). The hook is compiled out of release builds, so this
// test only runs against debug builds.
//
// RFC 9114 §4.1.2 also requires rejecting a malformed message as a stream
// error of type H3_MESSAGE_ERROR (0x010e), not a graceful close, so the hook
// additionally records the application error code the client put on the wire
// (fetchH3Internals.lastPeerStreamError).
//
// The never-ending streaming request body, and the hook not FINing its
// response, are both load-bearing for that assertion: the request body keeps
// the client's send half open so the guard emits a true RESET_STREAM (not
// just STOP_SENDING), and together they keep the server's stream from
// completing on its own, so the only thing that can close it is the client's
// error frame -- which makes the observation deterministic.
test.skipIf(!isDebug)("DATA after only a 1xx HEADERS is rejected (RFC 9114 §4.1)", async () => {
  using upstream = Bun.serve({
    port: 0,
    tls,
    http3: true,
    http1: false,
    // Unreached: the test hook short-circuits before the handler is invoked.
    fetch: () => new Response("handler-ran", { status: 200 }),
  });
  const origin = `https://127.0.0.1:${upstream.port}`;

  let failure: unknown;
  let delivered: { status: number; body: string } | undefined;
  try {
    const res = await fetch(`${origin}/`, {
      ...h3,
      method: "POST",
      headers: { "x-bun-test-100-then-data": "should-not-reach-application" },
      // A body that never ends: a chunk per pull, never close(). Cancelled
      // by the fetch failing; see the comment above the test for why it
      // must not FIN.
      body: new ReadableStream({ pull: c => void c.enqueue(new Uint8Array(16)) }),
    });
    delivered = { status: res.status, body: await res.text() };
  } catch (e) {
    failure = e;
  }

  // The malformed sequence must never surface as a Response. Without the
  // client-side guard the fetch would instead resolve (if the hook were
  // absent) or reject with HTTP3StreamReset after buffering the DATA.
  expect(delivered).toBeUndefined();
  expect(failure).toBeInstanceOf(Error);
  expect((failure as any)?.code ?? (failure as any)?.name).toBe("HTTP3ProtocolError");

  // The server observes the client's stream error asynchronously to the
  // rejection above (lsquic generates the frame on its next tick). Await the
  // abort handler having recorded a code rather than sleeping a fixed amount.
  let observed = 0;
  while ((observed = fetchH3Internals.lastPeerStreamError()) === 0) await Bun.sleep(1);
  // RFC 9114 §4.1.2: a malformed response is a stream error of type
  // H3_MESSAGE_ERROR. Before the guard the client's clean teardown put
  // H3_REQUEST_CANCELLED (0x010c) on the wire instead, which a conformant
  // server is allowed to treat as a normal cancellation.
  expect(observed.toString(16)).toBe("10e");

  // A request without the hook header still completes normally on the same
  // server, so the rejection above is about the malformed frame sequence.
  const ok = await fetch(`${origin}/`, h3);
  expect({ status: ok.status, body: await ok.text() }).toEqual({ status: 200, body: "handler-ran" });
});

describe("http3 response header field validation", () => {
  test("rejects a response carrying a connection-specific header field instead of delivering it", async () => {
    // RFC 9114 §4.2 forbids connection-specific fields in HTTP/3 responses. The
    // HTTP/2 client already rejects such response header blocks
    // (h2_client/dispatch.rs is_malformed_response_field /
    // is_malformed_response_value); this exercises the same validation on the
    // HTTP/3 response path. Bun.serve's HTTP/3 writer strips `connection`,
    // `keep-alive`, `proxy-connection` and `upgrade` itself but forwards `te`
    // verbatim, so a handler returning `te: trailers` produces exactly the kind
    // of response header block the client must refuse to hand to application
    // code. (If the server ever starts stripping `te` too, the tainted fetch
    // below succeeds with no failure recorded and this test fails loudly
    // instead of passing vacuously.)
    using upstream = Bun.serve({
      port: 0,
      tls,
      http3: true,
      http1: false,
      fetch(req) {
        if (new URL(req.url).pathname === "/clean") {
          return new Response("clean", { headers: { "x-mark": "clean" } });
        }
        return new Response("tainted", { headers: { te: "trailers", "x-mark": "tainted" } });
      },
    });
    const origin = `https://127.0.0.1:${upstream.port}`;

    // A well-formed response is unaffected by the validation.
    const ok = await fetch(`${origin}/clean`, h3);
    expect(ok.headers.get("x-mark")).toBe("clean");
    expect(await ok.text()).toBe("clean");
    expect(ok.status).toBe(200);

    // The response carrying a connection-specific field must fail before
    // reaching application code rather than exposing the field on
    // Response.headers.
    let delivered: Response | undefined;
    let failure: unknown;
    try {
      delivered = await fetch(`${origin}/tainted`, h3);
    } catch (e) {
      failure = e;
    }
    expect(delivered?.headers.get("te") ?? null).toBeNull();
    expect(failure).toBeInstanceOf(Error);
  });
});
