import { RedisClient, type TCPSocketListener } from "bun";
import { beforeEach, describe, expect, test } from "bun:test";
import { tempDir } from "harness";
import { join } from "node:path";
import { ConnectionType, createClient, ctx, isEnabled } from "../test-utils";

describe.skipIf(!isEnabled)("Valkey: Buffer Operations", () => {
  beforeEach(() => {
    if (ctx.redis?.connected) {
      ctx.redis.close?.();
    }
    ctx.redis = createClient(ConnectionType.TCP);
  });

  test("getBuffer returns binary data as Uint8Array", async () => {
    const key = ctx.generateKey("buffer-test");

    const binaryData = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f, 0x20, 0x77, 0x6f, 0x72, 0x6c, 0x64]);
    await ctx.redis.set(key, binaryData);

    const asString = await ctx.redis.get(key);
    const asBuffer = await ctx.redis.getBuffer(key);

    expectAssert(asString);
    expectAssert(asBuffer);

    expect(asBuffer.buffer).toBeInstanceOf(ArrayBuffer);
    expect(asBuffer).toBeInstanceOf(Uint8Array);
    expect(asBuffer.length).toBe(binaryData.length);
    expect(asBuffer).toStrictEqual(binaryData);

    for (let i = 0; i < binaryData.length; i++) {
      expect(asBuffer[i]).toBe(binaryData[i]);
    }

    const stringBuffer = Buffer.from(asString);
    expect(stringBuffer.length).toBe(binaryData.length);
  });

  test("getBuffer for non-existent key returns null", async () => {
    const key = ctx.generateKey("non-existent");
    const result = await ctx.redis.getBuffer(key);
    expect(result).toBeNull();
  });

  test("Really long buffer", async () => {
    const key = ctx.generateKey("long-buffer");
    const binaryData = new Uint8Array(1000000);
    await ctx.redis.set(key, binaryData);
    const result = await ctx.redis.getBuffer(key);
    expect(result).toBeInstanceOf(Uint8Array);
  });

  test("Buffer with no bytes", async () => {
    const key = ctx.generateKey("empty-buffer");
    const binaryData = new Uint8Array(0);
    await ctx.redis.set(key, binaryData);
    const result = await ctx.redis.getBuffer(key);
    expectAssert(result);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(0);
  });

  test("Buffer with null bytes", async () => {
    const key = ctx.generateKey("null-bytes");
    const binaryData = new Uint8Array([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09]);
    await ctx.redis.set(key, binaryData);
    const result = await ctx.redis.getBuffer(key);
    expectAssert(result);
    expect(result).toBeInstanceOf(Uint8Array);
    expect(result.length).toBe(binaryData.length);
    for (let i = 0; i < binaryData.length; i++) {
      expect(result[i]).toBe(binaryData[i]);
    }
  });

  test("concurrent getBuffer against large blob", async () => {
    const key = ctx.generateKey("concurrent");
    const big = new Uint8Array(500_000).map((_, i) => i % 256);
    await ctx.redis.set(key, big);
    const readers = Array.from({ length: 20 }, () => ctx.redis.getBuffer(key));
    const results = await Promise.all(readers);
    for (const r of results) expect(r).toStrictEqual(big);
  });

  test("set and getBuffer with ArrayBufferView key", async () => {
    const keyBytes = new Uint8Array([0x6b, 0x65, 0x79, 0x21]); // "key!"
    const value = new Uint8Array([0x01, 0x02, 0x03]);
    await ctx.redis.set(keyBytes, value);
    const out = await ctx.redis.getBuffer(keyBytes);
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out).toStrictEqual(value);
  });

  test("set and getBuffer with ArrayBuffer key", async () => {
    const keyBuffer = new Uint8Array([0x62, 0x75, 0x6e, 0x21]).buffer; // "bun!"
    expect(keyBuffer).toBeInstanceOf(ArrayBuffer);
    const value = new Uint8Array([0x0a, 0x0b]);
    await ctx.redis.set(keyBuffer, value);
    const out = await ctx.redis.getBuffer(keyBuffer);
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out).toStrictEqual(value);
  });

  test("set and getBuffer with Blob key", async () => {
    const keyBytes = new Uint8Array([0x74, 0x65, 0x73, 0x74]); // "test"
    const keyBlob = new Blob([keyBytes]);
    const value = new Uint8Array([0xff, 0xee, 0xdd]);
    await ctx.redis.set(keyBlob, value);
    const out = await ctx.redis.getBuffer(keyBlob);
    expect(out).toBeInstanceOf(Uint8Array);
    expect(out).toStrictEqual(value);
  });
});

function expectAssert(value: unknown): asserts value {
  expect(value).toBeTruthy();
}

// Argument-serialization tests that run without a real server. A Blob whose
// bytes live off-heap (Bun.file / S3) has an empty in-memory view; before the
// fix, that view was silently written to the wire as a zero-length bulk string.
describe("Valkey: Blob argument serialization", () => {
  const CRLF = "\r\n";
  const HELLO = `%1${CRLF}$5${CRLF}proto${CRLF}:3${CRLF}`;

  type PerSocket = { buf: string; hello: boolean };

  function createRecorder(): { server: TCPSocketListener<PerSocket>; wire: string[][] } {
    const wire: string[][] = [];
    const server = Bun.listen<PerSocket>({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open(s) {
          s.data = { buf: "", hello: false };
        },
        data(s, d) {
          const st = s.data;
          st.buf += d.toString("latin1");
          let out = "";
          for (;;) {
            const m = /^\*(\d+)\r\n/.exec(st.buf);
            if (!m) break;
            let i = m[0].length;
            const argv: string[] = [];
            let ok = true;
            for (let k = 0; k < +m[1]; k++) {
              const mm = /^\$(\d+)\r\n/.exec(st.buf.slice(i));
              if (!mm) {
                ok = false;
                break;
              }
              const L = +mm[1];
              if (st.buf.length < i + mm[0].length + L + 2) {
                ok = false;
                break;
              }
              argv.push(st.buf.substr(i + mm[0].length, L));
              i += mm[0].length + L + 2;
            }
            if (!ok) break;
            st.buf = st.buf.slice(i);
            if (!st.hello) {
              st.hello = true;
              out += HELLO;
              continue;
            }
            wire.push(argv);
            out += `+OK${CRLF}`;
          }
          if (out) s.write(out);
        },
        close() {},
        error() {},
      },
    });
    return { server, wire };
  }

  test("in-memory Blob arguments reach the wire with their bytes intact", async () => {
    const { server, wire } = createRecorder();
    const client = new RedisClient(`redis://127.0.0.1:${server.port}`, { autoReconnect: false });
    try {
      await client.connect();
      await client.set("mem", new Blob(["blobdata"]));
      await client.set("sliced", new Blob(["0123456789"]).slice(2, 5));
      await client.set(new Blob(["keyblob"]), "v");
    } finally {
      client.close();
      server.stop(true);
    }
    expect(wire).toEqual([
      ["SET", "mem", "blobdata"],
      ["SET", "sliced", "234"],
      ["SET", "keyblob", "v"],
    ]);
  });

  test("file-backed Blob arguments are rejected instead of serialized as empty", async () => {
    using dir = tempDir("valkey-file-blob", { "src.txt": "FILEDATA123" });
    const fpath = join(String(dir), "src.txt");

    const { server, wire } = createRecorder();
    const client = new RedisClient(`redis://127.0.0.1:${server.port}`, { autoReconnect: false });
    try {
      await client.connect();

      const expected = expect.objectContaining({
        code: "ERR_INVALID_ARG_TYPE",
        message: expect.stringMatching(/file- or S3-backed Blob/),
      });
      // value position
      expect(() => client.set("file", Bun.file(fpath))).toThrow(expected);
      // key position
      expect(() => client.set(Bun.file(fpath), "as-key")).toThrow(expected);
      // single-part Blob around a file-backed Blob shares the file store
      expect(() => client.set("wrapped", new Blob([Bun.file(fpath)]))).toThrow(expected);
      // reading the file once does not make the Blob itself in-memory
      const bf = Bun.file(fpath);
      await bf.text();
      expect(() => client.set("fileRead", bf)).toThrow(expected);
      // nonexistent path is still a file-backed Blob
      expect(() => client.set("missing", Bun.file(join(String(dir), "no.txt")))).toThrow(expected);
      // S3-backed Blob (no network: the throw happens in argument conversion)
      const s3 = new Bun.S3Client({
        accessKeyId: "x",
        secretAccessKey: "y",
        bucket: "b",
        endpoint: "http://127.0.0.1:1",
      });
      expect(() => client.set("s3", s3.file("some-key"))).toThrow(expected);
      // other prototype methods route through the same converter
      expect(() => client.getBuffer(Bun.file(fpath))).toThrow(expected);
      expect(() => client.append("k", Bun.file(fpath))).toThrow(expected);

      // nothing above should have produced a frame
      await client.set("after", "ok");
    } finally {
      client.close();
      server.stop(true);
    }
    expect(wire).toEqual([["SET", "after", "ok"]]);
  });
});
