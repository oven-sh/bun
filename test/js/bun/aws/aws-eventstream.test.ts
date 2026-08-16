import { describe, expect, test } from "bun:test";

// Frames produced by @smithy/eventstream-codec (the AWS SDK for JavaScript's
// implementation) for the messages described next to them.
const reference = {
  // {":message-type":"event",":event-type":"chunk",":content-type":"application/json"} + Bedrock-style {"bytes": base64(json)}
  bedrockChunk:
    "AAAAswAAAEvTSzW1DTptZXNzYWdlLXR5cGUHAAVldmVudAs6ZXZlbnQtdHlwZQcABWNodW5rDTpjb250ZW50LXR5cGUHABBhcHBsaWNhdGlvbi9qc29ueyJieXRlcyI6ImV5SjBlWEJsSWpvaVkyOXVkR1Z1ZEY5aWJHOWphMTlrWld4MFlTSXNJbVJsYkhSaElqcDdJblJsZUhRaU9pSklaV3hzYnlKOWZRPT0ifQQ557A=",
  // every header value type, empty payload
  allHeaderTypes:
    "AAAAkwAAAIOHNVAzCWJvb2wtdHJ1ZQAKYm9vbC1mYWxzZQEGYS1ieXRlAvsHYS1zaG9ydAP+1AZhbi1pbnQEAAHiQAZhLWxvbmcF/////////4UDYmluBgAEAQID/gNzdHIHAApow6lsbG8g4pyTAnRzCAAAAYvP5Wh7AmlkCQECAwQFBgcICQoLDA0ODxArAf87",
  // {":message-type":"exception",":exception-type":"ValidationException"} + {"message":"Malformed input request"}
  exception:
    "AAAAlgAAAGEB0VwXDTptZXNzYWdlLXR5cGUHAAlleGNlcHRpb24POmV4Y2VwdGlvbi10eXBlBwATVmFsaWRhdGlvbkV4Y2VwdGlvbg06Y29udGVudC10eXBlBwAQYXBwbGljYXRpb24vanNvbnsibWVzc2FnZSI6Ik1hbGZvcm1lZCBpbnB1dCByZXF1ZXN0In24Hegc",
  // {":message-type":"error",":error-code":"InternalError",":error-message":"boom"}
  error:
    "AAAAWAAAAEgVRpLBDTptZXNzYWdlLXR5cGUHAAVlcnJvcgs6ZXJyb3ItY29kZQcADUludGVybmFsRXJyb3IOOmVycm9yLW1lc3NhZ2UHAARib29tlhy0Vg==",
};
const bytes = (b64: string) => new Uint8Array(Buffer.from(b64, "base64"));

/** Minimal encoder (string headers only) for building test streams. */
function frame(headers: Record<string, string>, payload: string | Uint8Array): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  for (const [k, v] of Object.entries(headers)) {
    const kb = enc.encode(k),
      vb = enc.encode(v);
    parts.push(new Uint8Array([kb.length]), kb, new Uint8Array([7, vb.length >> 8, vb.length & 255]), vb);
  }
  const hbuf = Buffer.concat(parts);
  const body = typeof payload === "string" ? enc.encode(payload) : payload;
  const total = 16 + hbuf.length + body.length;
  const out = Buffer.alloc(total);
  out.writeUInt32BE(total, 0);
  out.writeUInt32BE(hbuf.length, 4);
  out.writeUInt32BE(Bun.hash.crc32(out.subarray(0, 8)), 8);
  hbuf.copy(out, 12);
  Buffer.from(body).copy(out, 12 + hbuf.length);
  out.writeUInt32BE(Bun.hash.crc32(out.subarray(0, total - 4)), total - 4);
  return new Uint8Array(out);
}

async function collect(source: unknown) {
  const out: any[] = [];
  for await (const m of Bun.aws.eventStream(source as any)) out.push(m);
  return out;
}

describe("Bun.aws.eventStream", () => {
  test("decodes SDK-produced frames: Bedrock chunk, every header type", async () => {
    const [chunk] = await collect(bytes(reference.bedrockChunk));
    expect(chunk.type).toBe("event");
    expect(chunk.event).toBe("chunk");
    expect(chunk.contentType).toBe("application/json");
    expect(JSON.parse(atob((chunk.json() as any).bytes))).toEqual({
      type: "content_block_delta",
      delta: { text: "Hello" },
    });

    const [typed] = await collect(bytes(reference.allHeaderTypes));
    expect(typed.payload.byteLength).toBe(0);
    expect(typed.type).toBeUndefined();
    expect(typed.headers).toEqual({
      "bool-true": true,
      "bool-false": false,
      "a-byte": -5,
      "a-short": -300,
      "an-int": 123456,
      "a-long": -123n,
      bin: new Uint8Array([1, 2, 3, 254]),
      str: "héllo ✓",
      ts: new Date("2023-11-14T22:13:20.123Z"),
      id: "01020304-0506-0708-090a-0b0c0d0e0f10",
    });
  });

  test("exception and error frames throw like the SDKs", async () => {
    let err: any;
    try {
      await collect(bytes(reference.exception));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("ValidationException");
    expect(err.code).toBe("ERR_AWS_EVENT_STREAM_EXCEPTION");
    expect(err.message).toBe("Malformed input request");
    expect(err.headers[":content-type"]).toBe("application/json");
    expect(JSON.parse(err.body)).toEqual({ message: "Malformed input request" }); // whole payload, for extra members

    err = undefined;
    try {
      await collect(bytes(reference.error));
    } catch (e) {
      err = e;
    }
    expect(err.name).toBe("InternalError");
    expect(err.code).toBe("ERR_AWS_EVENT_STREAM_ERROR");
    expect(err.message).toBe("boom");

    // Events before the exception are still delivered.
    const seen: string[] = [];
    err = undefined;
    try {
      const both = Buffer.concat([
        frame({ ":message-type": "event", ":event-type": "a" }, "1"),
        bytes(reference.exception),
      ]);
      for await (const m of Bun.aws.eventStream(both)) seen.push(m.event!);
    } catch (e) {
      err = e;
    }
    expect(seen).toEqual(["a"]);
    expect(err?.name).toBe("ValidationException");
  });

  test("frames split across arbitrary chunk boundaries (ReadableStream, async iterable, Response)", async () => {
    const messages = Array.from({ length: 20 }, (_, i) =>
      frame(
        { ":message-type": "event", ":event-type": "n" },
        JSON.stringify({ i, pad: Buffer.alloc(i * 37, "x").toString() }),
      ),
    );
    const all = Buffer.concat(messages);
    for (const step of [1, 3, 11, 12, 13, 64, all.length]) {
      const stream = new ReadableStream({
        start(controller) {
          for (let i = 0; i < all.length; i += step) controller.enqueue(all.subarray(i, i + step));
          controller.close();
        },
      });
      const got = await collect(stream);
      expect(got.map(m => (m.json() as any).i)).toEqual(messages.map((_, i) => i));
    }
    async function* gen() {
      yield all.subarray(0, 7);
      yield all.subarray(7, 700).buffer.slice(all.byteOffset + 7, all.byteOffset + 700); // an ArrayBuffer chunk
      yield all.subarray(700);
    }
    expect((await collect(gen())).length).toBe(20);
    expect((await collect(new Response(all))).length).toBe(20);
    expect((await collect(new Blob([all]))).length).toBe(20);
    expect(await collect(new Uint8Array(0))).toEqual([]);
  });

  test("corruption and truncation are errors, not silent data loss", async () => {
    const good = frame({ ":message-type": "event" }, "payload");
    const cases: [string, Uint8Array, RegExp][] = [
      ["payload bit flip", good.map((b, i) => (i === 40 ? b ^ 1 : b)), /message checksum/],
      ["prelude bit flip", good.map((b, i) => (i === 5 ? b ^ 1 : b)), /prelude checksum/],
      ["truncated", good.subarray(0, good.length - 1), /middle of a message/],
      ["trailing garbage", new Uint8Array([...good, 1, 2, 3]), /middle of a message/],
      [
        "invalid UTF-8 header name",
        (() => {
          const f = Buffer.from(frame({ abc: "v" }, ""));
          f[13] = 0xff; // first byte of the header name
          f.writeUInt32BE(Bun.hash.crc32(f.subarray(0, f.length - 4)), f.length - 4);
          return new Uint8Array(f);
        })(),
        /not valid UTF-8/,
      ],
    ];
    for (const [name, data, pattern] of cases) {
      let err: any;
      try {
        await collect(data);
      } catch (e) {
        err = e;
      }
      expect(err?.code, name).toBe("ERR_AWS_EVENT_STREAM");
      expect(err.message, name).toMatch(pattern);
    }
    // absurd total_length is rejected up front rather than buffered forever
    const huge = Buffer.from(good);
    huge.writeUInt32BE(0x7fffffff, 0);
    huge.writeUInt32BE(Bun.hash.crc32(huge.subarray(0, 8)), 8);
    await expect(collect(new Uint8Array(huge))).rejects.toThrow(/bad frame lengths/);
    // not a byte source: rejected at the call, not on first read
    expect(() => Bun.aws.eventStream(42 as any)).toThrow(/"source" argument must be/);
    // messages decoded before a bad frame in the same chunk are still delivered
    const seen: string[] = [];
    let err: any;
    try {
      const evt = frame({ ":message-type": "event", ":event-type": "ok" }, "1");
      for await (const m of Bun.aws.eventStream(Buffer.concat([evt, evt, good.map((b, i) => (i === 40 ? b ^ 1 : b))])))
        seen.push(m.event!);
    } catch (e) {
      err = e;
    }
    expect(seen).toEqual(["ok", "ok"]);
    expect(err?.code).toBe("ERR_AWS_EVENT_STREAM");
  });

  test("payloads are copies the caller owns; a producer may reuse its buffer between chunks", async () => {
    const one = Buffer.from(frame({ ":message-type": "event", bin: "x" }, "hello"));
    const [m] = await collect(one);
    one.fill(0);
    expect(m.text()).toBe("hello");
    expect(m.payload.buffer).not.toBe(one.buffer);
    // always a plain Uint8Array, wherever chunk boundaries fell
    expect(m.payload.constructor).toBe(Uint8Array);
    // non-configurable like the class's other methods
    expect(Object.getOwnPropertyDescriptor(Bun.AWSClient.prototype, "eventStream")?.configurable).toBe(false);

    const all = Buffer.concat(
      Array.from({ length: 6 }, (_, i) =>
        frame({ ":message-type": "event", ":event-type": "e" + i }, Buffer.alloc(50 + i, "p").toString()),
      ),
    );
    async function* reusing(size: number) {
      const scratch = new Uint8Array(size);
      for (let i = 0; i < all.length; i += size) {
        const n = Math.min(size, all.length - i);
        scratch.set(all.subarray(i, i + n));
        yield scratch.subarray(0, n);
        scratch.fill(0xee); // clobber what we handed out
      }
    }
    for (const size of [7, 30, 100, 250]) {
      expect((await collect(reusing(size))).map(m => m.event)).toEqual(["e0", "e1", "e2", "e3", "e4", "e5"]);
    }

    // One large frame dribbled in small chunks is reassembled without
    // re-copying what was already buffered (this would take minutes if quadratic).
    const big = frame({ ":message-type": "event" }, new Uint8Array(Buffer.alloc(4 * 1024 * 1024, "z")));
    async function* dribble() {
      for (let i = 0; i < big.length; i += 1024) yield big.subarray(i, i + 1024);
    }
    const [whole] = await collect(dribble());
    expect(whole.payload.length).toBe(4 * 1024 * 1024);
  });

  test("a chunk is fully consumed before yielding, so ring-buffer producers are safe", async () => {
    // Two frames in one buffer that is clobbered while the consumer holds
    // the first message: the second must already have been copied out.
    const scratch = new Uint8Array(
      Buffer.concat([
        frame({ ":message-type": "event", ":event-type": "one" }, "1"),
        frame({ ":message-type": "event", ":event-type": "two" }, "2"),
      ]),
    );
    const source = {
      async *[Symbol.asyncIterator]() {
        yield scratch;
      },
    };
    const seen: string[] = [];
    for await (const m of Bun.aws.eventStream(source)) {
      seen.push(m.event!);
      scratch.fill(0xee);
    }
    expect(seen).toEqual(["one", "two"]);
    // payload text is decoded leniently (split multi-byte sequences happen in byte streams)
    const [m] = await collect(frame({ ":message-type": "event" }, new Uint8Array([0x68, 0xff, 0x69])));
    expect(m.text()).toBe("h\ufffdi");
  });

  test("a non-2xx Response is reported with its status and message instead of being framed", async () => {
    using server = Bun.serve({
      port: 0,
      fetch: () =>
        Response.json(
          { message: "The security token included in the request is expired" },
          {
            status: 403,
            headers: {
              "x-amzn-errortype": "ExpiredTokenException:http://internal.amazon.com/coral/com.amazon.coral.service/",
            },
          },
        ),
    });
    let err: any;
    try {
      await collect(await fetch(server.url));
    } catch (e) {
      err = e;
    }
    expect(err?.code).toBe("ERR_AWS_EVENT_STREAM_RESPONSE");
    expect(err.name).toBe("ExpiredTokenException");
    expect(err.status).toBe(403);
    expect(err.message).toBe("HTTP 403: The security token included in the request is expired");
    expect(JSON.parse(err.body).message).toBe("The security token included in the request is expired");
    expect(err.headers.get("x-amzn-errortype")).toStartWith("ExpiredTokenException");

    // an already-consumed body is an error, not an empty stream
    const used = await fetch(server.url);
    await used.text();
    await expect(collect(new Response("x", { status: 200 }))).rejects.toThrow(/middle of a message/);
    await expect(collect(used)).rejects.toThrow(/HTTP 403/); // !ok is checked first
    const ok = new Response(frame({ ":message-type": "event" }, "x"));
    await ok.arrayBuffer();
    await expect(collect(ok)).rejects.toThrow(/already consumed/);
  });

  test("end to end: signed request to a streaming endpoint, decoded as it arrives", async () => {
    let authorization: string | null = null;
    let release!: () => void;
    const gate = new Promise<void>(r => (release = r));
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        authorization = req.headers.get("authorization");
        return new Response(
          new ReadableStream({
            async start(controller) {
              controller.enqueue(
                frame({ ":message-type": "event", ":event-type": "messageStart" }, `{"role":"assistant"}`),
              );
              await gate; // the client must see the first event before the rest is sent
              for (const word of ["Hello", ", ", "world"]) {
                controller.enqueue(
                  frame(
                    { ":message-type": "event", ":event-type": "contentBlockDelta" },
                    JSON.stringify({ delta: { text: word } }),
                  ),
                );
              }
              controller.enqueue(
                frame({ ":message-type": "event", ":event-type": "messageStop" }, `{"stopReason":"end_turn"}`),
              );
              controller.close();
            },
          }),
          { headers: { "content-type": "application/vnd.amazon.eventstream" } },
        );
      },
    });
    const res = await Bun.aws.fetch(`${server.url}model/x/converse-stream`, {
      method: "POST",
      body: "{}",
      accessKeyId: "AKID",
      secretAccessKey: "secret",
      service: "bedrock",
      region: "us-east-1",
    });
    let text = "";
    const events: string[] = [];
    for await (const m of Bun.aws.eventStream(res)) {
      events.push(m.event!);
      if (m.event === "messageStart") release();
      if (m.event === "contentBlockDelta") text += (m.json() as any).delta.text;
    }
    expect(events).toEqual([
      "messageStart",
      "contentBlockDelta",
      "contentBlockDelta",
      "contentBlockDelta",
      "messageStop",
    ]);
    expect(text).toBe("Hello, world");
    expect(authorization).toStartWith("AWS4-HMAC-SHA256 Credential=AKID/");
  });
});
