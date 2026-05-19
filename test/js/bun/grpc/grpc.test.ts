import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { bunEnv, bunExe, nodeExe } from "harness";
import { join } from "path";

import { Client, Status, StatusError } from "bun:grpc";

const fixturesDir = join(import.meta.dir, "..", "..", "third_party", "grpc-js");
const ca = readFileSync(join(fixturesDir, "fixtures", "ca.pem"));

// Protobuf encoding for `message EchoMessage { string value = 1; int32 value2 = 2; }`.
// Hand-rolled so this test doesn't depend on a protobuf library.
function encodeEchoMessage(value: string, value2: number): Uint8Array {
  const utf8 = new TextEncoder().encode(value);
  const out: number[] = [];
  // field 1, wire type 2 (LEN)
  out.push((1 << 3) | 2);
  writeVarint(out, utf8.length);
  for (const b of utf8) out.push(b);
  // field 2, wire type 0 (VARINT)
  out.push((2 << 3) | 0);
  writeVarint(out, value2 >>> 0);
  return Uint8Array.from(out);
}

function decodeEchoMessage(buf: Uint8Array): { value: string; value2: number } {
  let i = 0;
  let value = "";
  let value2 = 0;
  while (i < buf.length) {
    const tag = buf[i++];
    const field = tag >> 3;
    const wire = tag & 7;
    if (wire === 2) {
      const [len, n] = readVarint(buf, i);
      i += n;
      const slice = buf.subarray(i, i + len);
      i += len;
      if (field === 1) value = new TextDecoder().decode(slice);
    } else if (wire === 0) {
      const [v, n] = readVarint(buf, i);
      i += n;
      if (field === 2) value2 = v;
    } else {
      throw new Error(`unexpected wire type ${wire}`);
    }
  }
  return { value, value2 };
}

function writeVarint(out: number[], v: number) {
  while (v > 0x7f) {
    out.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  out.push(v & 0x7f);
}

function readVarint(buf: Uint8Array, i: number): [number, number] {
  let v = 0;
  let shift = 0;
  let n = 0;
  while (true) {
    const b = buf[i + n++];
    v |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
  }
  return [v, n];
}

async function startServer(extraEnv: Record<string, string> = {}) {
  const exe = nodeExe() ?? bunExe();
  const proc = Bun.spawn({
    cmd: [exe, join(import.meta.dir, "grpc-server.fixture.cjs")],
    env: { ...bunEnv, ...extraEnv },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  });
  // The fixture writes its listening address to stdout as JSON once bound.
  const reader = proc.stdout.getReader();
  let acc = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) throw new Error("grpc fixture exited before reporting address");
    acc += new TextDecoder().decode(value);
    if (acc.includes("}")) break;
  }
  reader.releaseLock();
  const address = JSON.parse(acc);
  const port: number = address.port;
  return {
    port,
    url: `https://localhost:${port}`,
    async close() {
      try {
        proc.stdin.write("shutdown");
        await proc.stdin.end();
      } catch {}
      await proc.exited;
    },
    [Symbol.asyncDispose]() {
      return this.close();
    },
  };
}

describe("fetch(url, { grpc: true })", () => {
  let server: Awaited<ReturnType<typeof startServer>>;
  beforeAll(async () => {
    server = await startServer();
  });
  afterAll(async () => {
    await server.close();
  });

  test("unary echo round-trips payload and exposes grpc-status", async () => {
    const payload = encodeEchoMessage("hello from bun", 42);
    const response = await fetch(`${server.url}/EchoService/Echo`, {
      method: "POST",
      body: payload,
      grpc: true,
      tls: { ca },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toStartWith("application/grpc");
    // Trailers are merged into headers so grpc-status is readable here.
    expect(response.headers.get("grpc-status")).toBe("0");

    const body = new Uint8Array(await response.arrayBuffer());
    // The native layer strips the 5-byte Length-Prefixed-Message header.
    const decoded = decodeEchoMessage(body);
    expect(decoded).toEqual({ value: "hello from bun", value2: 42 });
  });

  test("empty request body is still framed", async () => {
    const response = await fetch(`${server.url}/EchoService/Echo`, {
      method: "POST",
      body: new Uint8Array(0),
      grpc: true,
      tls: { ca },
    });
    expect(response.headers.get("grpc-status")).toBe("0");
    // A 0-byte request message is a valid EchoMessage with all defaults;
    // the server echoes back defaults which proto-loader serialises with
    // explicit zero fields. The point of this test is that the request
    // was accepted (i.e. the 5-byte LPM header was sent even for an
    // empty body), so decoding is sufficient.
    const body = new Uint8Array(await response.arrayBuffer());
    expect(decodeEchoMessage(body)).toEqual({ value: "", value2: 0 });
  });

  test("unknown method yields UNIMPLEMENTED in merged trailers", async () => {
    const response = await fetch(`${server.url}/EchoService/DoesNotExist`, {
      method: "POST",
      body: new Uint8Array(0),
      grpc: true,
      tls: { ca },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("grpc-status")).toBe(String(Status.UNIMPLEMENTED));
    expect(response.headers.get("grpc-message")).toBeTruthy();
  });

  test("forwards user metadata as request headers", async () => {
    // The echo server reflects request metadata back via sendMetadata.
    const response = await fetch(`${server.url}/EchoService/Echo`, {
      method: "POST",
      body: encodeEchoMessage("meta", 1),
      headers: { "x-bun-test": "abc" },
      grpc: true,
      tls: { ca },
    });
    expect(response.headers.get("grpc-status")).toBe("0");
    expect(response.headers.get("x-bun-test")).toBe("abc");
  });
});

describe("bun:grpc Client", () => {
  let server: Awaited<ReturnType<typeof startServer>>;
  beforeAll(async () => {
    server = await startServer();
  });
  afterAll(async () => {
    await server.close();
  });

  test("Status enum is exported", () => {
    expect(Status.OK).toBe(0);
    expect(Status.UNAVAILABLE).toBe(14);
    expect(Status.UNAUTHENTICATED).toBe(16);
  });

  test("unary() round-trips via /package.Service/Method", async () => {
    const client = new Client(`localhost:${server.port}`, { tls: { ca } });
    const request = encodeEchoMessage("bun:grpc works", 7);
    const result = await client.unary("/EchoService/Echo", request);

    expect(result.status).toBe(Status.OK);
    expect(result.headers.get("grpc-status")).toBe("0");
    const decoded = decodeEchoMessage(result.data);
    expect(decoded).toEqual({ value: "bun:grpc works", value2: 7 });
  });

  test("unary() throws StatusError for non-OK status", async () => {
    const client = new Client(`localhost:${server.port}`, { tls: { ca } });
    let thrown: unknown;
    try {
      await client.unary("/EchoService/DoesNotExist", new Uint8Array(0));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(StatusError);
    const err = thrown as InstanceType<typeof StatusError>;
    expect(err.code).toBe(Status.UNIMPLEMENTED);
    expect(err.details.length).toBeGreaterThan(0);
  });

  test("unary() maps transport failures to StatusError(UNAVAILABLE)", async () => {
    const client = new Client("localhost:1", { tls: { rejectUnauthorized: false } });
    let thrown: unknown;
    try {
      await client.unary("/EchoService/Echo", new Uint8Array(0));
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(StatusError);
    expect((thrown as InstanceType<typeof StatusError>).code).toBe(Status.UNAVAILABLE);
  });

  test("unary() maps AbortSignal to CANCELLED", async () => {
    const client = new Client(`localhost:${server.port}`, { tls: { ca } });
    const controller = new AbortController();
    const p = client.unary("/EchoService/Echo", encodeEchoMessage("x", 1), { signal: controller.signal });
    controller.abort();
    let thrown: unknown;
    try {
      await p;
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(StatusError);
    expect((thrown as InstanceType<typeof StatusError>).code).toBe(Status.CANCELLED);
  });

  test("request() returns the raw Response without status handling", async () => {
    const client = new Client(`localhost:${server.port}`, { tls: { ca } });
    const response = await client.request("EchoService/Echo", encodeEchoMessage("raw", 0));
    expect(response).toBeInstanceOf(Response);
    expect(response.headers.get("grpc-status")).toBe("0");
  });
});

describe("bun:grpc Client against retry-behavior server", () => {
  let server: Awaited<ReturnType<typeof startServer>>;
  beforeAll(async () => {
    server = await startServer({ GRPC_SERVICE_TYPE: "1" });
  });
  afterAll(async () => {
    await server.close();
  });

  test("server-specified status code is surfaced", async () => {
    const client = new Client(`localhost:${server.port}`, { tls: { ca } });
    let thrown: unknown;
    try {
      await client.unary("/EchoService/Echo", encodeEchoMessage("x", 1), {
        headers: {
          "succeed-on-retry-attempt": "5",
          "respond-with-status": String(Status.RESOURCE_EXHAUSTED),
        },
      });
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(StatusError);
    expect((thrown as InstanceType<typeof StatusError>).code).toBe(Status.RESOURCE_EXHAUSTED);
  });
});
