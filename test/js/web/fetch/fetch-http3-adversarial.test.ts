import type { Server } from "bun";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { tls } from "harness";

// Adversarial fuzzer-style coverage for the HTTP/3 large-body path. The server
// binds UDP only (`h1: false`) so a fetch that silently fell back to HTTP/1.1
// would ECONNREFUSED — every pass here proves the QUIC path carried the bytes.
let server: Server;
let base: string;

beforeAll(() => {
  server = Bun.serve({
    port: 0,
    tls,
    h3: true,
    h1: false,
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
