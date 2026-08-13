import { describe, expect, it } from "bun:test";
import http2 from "node:http2";

// node's buildNgHeaderString drops a property whose value is undefined before it looks at the
// name, so such a property is neither validated, nor counted as an occurrence of a single-value
// field, nor sent. Every outbound block builder has to agree on that: the native encoders behind
// request()/respond()/additionalHeaders(), sendTrailers() and pushStream(), and the checks the JS
// layer runs before encoding. The expected values below are what node v26.3.0 produces for the
// same blocks.
describe("http2 undefined header values", () => {
  // The fields a peer decoded from the wire as a flat [name, value, ...] list, without the
  // pseudo-headers and the date respond() adds on its own.
  function fieldsOf(rawHeaders) {
    const fields = [];
    for (let i = 0; i < rawHeaders.length; i += 2) {
      if (rawHeaders[i].startsWith(":") || rawHeaders[i] === "date") continue;
      fields.push(rawHeaders[i], rawHeaders[i + 1]);
    }
    return fields;
  }

  // Runs `body(client)` against a server that hands every request to `onStream(stream, headers,
  // fields)` and resolves with body's result. Any error on either side (both sessions and any
  // pushed stream included) fails the test, so a header block that is rejected half-way, or one
  // that leaves the shared HPACK table out of step with the peer, shows up even when the
  // individual request looks fine.
  async function withSession(onStream, body) {
    const { promise: failure, reject } = Promise.withResolvers();
    const server = http2.createServer();
    server.on("error", reject);
    server.on("sessionError", reject);
    server.on("stream", (stream, headers, flags, rawHeaders) => {
      stream.on("error", reject);
      onStream(stream, headers, fieldsOf(rawHeaders));
    });
    let client;
    try {
      await new Promise(listening => server.listen(0, "127.0.0.1", listening));
      client = http2.connect(`http://127.0.0.1:${server.address().port}`);
      client.on("error", reject);
      client.on("stream", pushed => {
        pushed.on("error", reject);
        pushed.resume();
      });
      return await Promise.race([failure, body(client)]);
    } finally {
      client?.close();
      server.close();
    }
  }

  // Resolves with what the client saw for one request: the response status, the fields of every
  // informational ('headers') block, the response block and the trailers block (null when the
  // peer sent none), and the stream's rstCode once it closed.
  function observe(client, headers, options = { endStream: true }) {
    return new Promise((resolve, reject) => {
      const req = client.request(headers, options);
      const seen = { status: undefined, info: [], response: null, trailers: null, rstCode: undefined };
      req.on("error", reject);
      req.on("headers", (_headers, _flags, rawHeaders) => seen.info.push(fieldsOf(rawHeaders)));
      req.on("response", (responseHeaders, _flags, rawHeaders) => {
        seen.status = responseHeaders[":status"];
        seen.response = fieldsOf(rawHeaders);
      });
      req.on("trailers", (_headers, _flags, rawHeaders) => (seen.trailers = fieldsOf(rawHeaders)));
      req.on("close", () => {
        seen.rstCode = req.rstCode;
        resolve(seen);
      });
      req.resume();
    });
  }

  it("request() sends the block without the undefined-valued properties", async () => {
    const received = [];
    const result = await withSession(
      (stream, _headers, fields) => {
        received.push(fields);
        stream.respond({ ":status": 200 }, { endStream: true });
      },
      async client => {
        const first = await observe(client, {
          ":path": "/object",
          // Skipped before the name is validated.
          ":bogus": undefined,
          "bad name": undefined,
          // Not an occurrence of the single-value field, so the other spelling is the only one.
          "content-type": undefined,
          "Content-Type": "text/plain",
          // Not a content-length on this payload-less (endStream) request either.
          "content-length": undefined,
          "x-undefined": undefined,
          "x-ok": "1",
        });
        // Same in the other order: the undefined spelling is not a second occurrence either.
        const reversed = await observe(client, {
          ":path": "/reversed",
          "Content-Type": "text/plain",
          "content-type": undefined,
        });
        const raw = await observe(client, [":path", "/raw", "x-undefined", undefined, "x-ok", "1"]);
        // The session is still healthy afterwards: nothing was encoded and then thrown away.
        const after = await observe(client, { ":path": "/after", "x-after": "2" });
        return [first, reversed, raw, after].map(({ status, rstCode }) => ({ status, rstCode }));
      },
    );

    expect(received).toEqual([
      ["content-type", "text/plain", "x-ok", "1"],
      ["content-type", "text/plain"],
      ["x-ok", "1"],
      ["x-after", "2"],
    ]);
    expect(result).toEqual([
      { status: 200, rstCode: 0 },
      { status: 200, rstCode: 0 },
      { status: 200, rstCode: 0 },
      { status: 200, rstCode: 0 },
    ]);
  });

  it("respond() sends the block without the undefined-valued properties", async () => {
    const thrown = [];
    const result = await withSession(
      (stream, headers) => {
        try {
          switch (headers[":path"]) {
            case "/object":
              stream.respond(
                {
                  ":status": 201,
                  ":bogus": undefined,
                  "bad name": undefined,
                  "content-type": undefined,
                  "Content-Type": "text/plain",
                  "x-undefined": undefined,
                  "x-ok": "1",
                },
                { endStream: true },
              );
              break;
            case "/only-undefined":
              // Nothing is left to send, but the block is still a valid (defaulted) response.
              stream.respond({ "x-undefined": undefined }, { endStream: true });
              break;
            case "/raw":
              stream.respond([":status", "200", "x-undefined", undefined, "x-ok", "1"], { endStream: true });
              break;
          }
        } catch (err) {
          thrown.push(err.code);
          stream.close();
        }
      },
      async client => {
        const object = await observe(client, { ":path": "/object" });
        const onlyUndefined = await observe(client, { ":path": "/only-undefined" });
        const raw = await observe(client, { ":path": "/raw" });
        return [object, onlyUndefined, raw].map(({ status, response, rstCode }) => ({ status, response, rstCode }));
      },
    );

    expect(thrown).toEqual([]);
    expect(result).toEqual([
      { status: 201, response: ["content-type", "text/plain", "x-ok", "1"], rstCode: 0 },
      { status: 200, response: [], rstCode: 0 },
      { status: 200, response: ["x-ok", "1"], rstCode: 0 },
    ]);
  });

  it("additionalHeaders() sends the block without the undefined-valued properties", async () => {
    const thrown = [];
    const result = await withSession(
      stream => {
        try {
          stream.additionalHeaders({
            ":status": 103,
            ":bogus": undefined,
            "content-type": undefined,
            "Content-Type": "text/plain",
            "x-undefined": undefined,
            "x-ok": "1",
          });
        } catch (err) {
          thrown.push(err.code);
        }
        stream.respond({ ":status": 200 }, { endStream: true });
      },
      async client => {
        const { status, info, rstCode } = await observe(client, { ":path": "/" });
        return { status, info, rstCode };
      },
    );

    expect(thrown).toEqual([]);
    expect(result).toEqual({ status: 200, info: [["content-type", "text/plain", "x-ok", "1"]], rstCode: 0 });
  });

  it("pushStream() sends the block without the undefined-valued properties", async () => {
    const pushBlocks = [
      {
        ":path": "/pushed",
        ":bogus": undefined,
        "bad name": undefined,
        connection: undefined,
        "content-type": undefined,
        "Content-Type": "text/plain",
        "x-undefined": undefined,
        "x-ok": "1",
      },
      { ":path": "/reversed", "Content-Type": "text/plain", "content-type": undefined },
    ];
    const thrown = [];
    const callbackErrors = [];
    const result = await withSession(
      stream => {
        for (const block of pushBlocks) {
          try {
            stream.pushStream(block, (err, push) => {
              if (err) {
                callbackErrors.push(err.code);
                return;
              }
              push.respond({ ":status": 200 }, { endStream: true });
            });
          } catch (err) {
            thrown.push(err.code);
          }
        }
        stream.respond({ ":status": 200 }, { endStream: true });
      },
      async client => {
        // Every PUSH_PROMISE is written before the parent's response, so once the parent request
        // has closed every push has been seen.
        const pushed = [];
        client.on("stream", (_push, headers, _flags, rawHeaders) => {
          pushed.push({ path: headers[":path"], fields: fieldsOf(rawHeaders) });
        });
        const { status, rstCode } = await observe(client, { ":path": "/" });
        return { status, rstCode, pushed };
      },
    );

    expect(thrown).toEqual([]);
    expect(callbackErrors).toEqual([]);
    expect(result).toEqual({
      status: 200,
      rstCode: 0,
      pushed: [
        { path: "/pushed", fields: ["content-type", "text/plain", "x-ok", "1"] },
        { path: "/reversed", fields: ["content-type", "text/plain"] },
      ],
    });
  });

  it("sendTrailers() sends the block without the undefined-valued properties", async () => {
    // sendTrailers() has no JS pre-check, so the native trailers walk is the only thing judging
    // these blocks, including the single-value rule in both spellings' orders.
    const trailerBlocks = {
      "/block": {
        // A trailer block rejects every pseudo-header name, so this one is skipped only
        // because its value is looked at first.
        ":status": undefined,
        "bad name": undefined,
        "content-type": undefined,
        "Content-Type": "text/plain",
        "x-undefined": undefined,
        "x-ok": "1",
      },
      "/reversed": { "Content-Type": "text/plain", "content-type": undefined },
    };
    const thrown = [];
    const result = await withSession(
      (stream, headers) => {
        stream.respond({ ":status": 200 }, { waitForTrailers: true });
        stream.on("wantTrailers", () => {
          try {
            stream.sendTrailers(trailerBlocks[headers[":path"]]);
          } catch (err) {
            thrown.push(err.code);
            stream.close();
          }
        });
        stream.end("body");
      },
      async client => {
        const results = [];
        for (const path of Object.keys(trailerBlocks)) {
          const { trailers, rstCode } = await observe(client, { ":path": path });
          results.push({ path, trailers, rstCode });
        }
        return results;
      },
    );

    expect(thrown).toEqual([]);
    expect(result).toEqual([
      { path: "/block", trailers: ["content-type", "text/plain", "x-ok", "1"], rstCode: 0 },
      { path: "/reversed", trailers: ["content-type", "text/plain"], rstCode: 0 },
    ]);
  });

  it("sendTrailers() with nothing left to send ends the stream without a trailers block", async () => {
    // node submits an empty header list as an empty DATA frame carrying END_STREAM, exactly as it
    // does for sendTrailers({}), so the peer sees the stream end and never gets a 'trailers' event.
    const trailerBlocks = {
      "/undefined": { "x-checksum": undefined },
      "/empty-array": { "x-checksum": [] },
      "/empty-object": {},
    };
    const thrown = [];
    const result = await withSession(
      (stream, headers) => {
        stream.respond({ ":status": 200 }, { waitForTrailers: true });
        stream.on("wantTrailers", () => {
          try {
            stream.sendTrailers(trailerBlocks[headers[":path"]]);
          } catch (err) {
            thrown.push(err.code);
            stream.close();
          }
        });
        stream.end("body");
      },
      async client => {
        const results = [];
        for (const path of Object.keys(trailerBlocks)) {
          const { trailers, rstCode } = await observe(client, { ":path": path });
          results.push({ path, trailers, rstCode });
        }
        return results;
      },
    );

    expect(thrown).toEqual([]);
    expect(result).toEqual([
      { path: "/undefined", trailers: null, rstCode: 0 },
      { path: "/empty-array", trailers: null, rstCode: 0 },
      { path: "/empty-object", trailers: null, rstCode: 0 },
    ]);
  });

  it("the compat layer still rejects undefined in writeEarlyHints() but passes writeInformation() through", async () => {
    // Http2ServerResponse validates header values itself, like setHeader() does, and node's
    // writeEarlyHints() is one of those validating entry points: every hint is checked the way
    // setHeader() checks a header, before the link list is even looked at. writeInformation()
    // hands its headers straight to additionalHeaders(), which skips the undefined value.
    const { promise: failure, reject } = Promise.withResolvers();
    const link = "</s.css>; rel=preload";
    let calls;
    let sentInfoHeaders;
    const server = http2.createServer((req, res) => {
      const attempt = fn => {
        try {
          return fn();
        } catch (err) {
          return err.code;
        }
      };
      calls = {
        earlyHintsUndefined: attempt(() => res.writeEarlyHints({ link, "x-hint": undefined })),
        earlyHintsPseudo: attempt(() => res.writeEarlyHints({ link, ":status": 103 })),
        earlyHintsWithoutLink: attempt(() => res.writeEarlyHints({ link: [], "x-hint": undefined })),
        earlyHints: attempt(() => res.writeEarlyHints({ link, " X-Hint ": "h" })),
        information: attempt(() => res.writeInformation(103, { "x-undefined": undefined, "x-info": "i" })),
      };
      sentInfoHeaders = res.stream.sentInfoHeaders.map(block => Object.keys(block));
      res.end("body");
    });
    server.on("sessionError", reject);
    let client;
    try {
      await new Promise(listening => server.listen(0, "127.0.0.1", listening));
      client = http2.connect(`http://127.0.0.1:${server.address().port}`);
      client.on("error", reject);
      const { status, info, rstCode } = await Promise.race([failure, observe(client, { ":path": "/" })]);
      expect(calls).toEqual({
        earlyHintsUndefined: "ERR_HTTP2_INVALID_HEADER_VALUE",
        earlyHintsPseudo: "ERR_HTTP2_PSEUDOHEADER_NOT_ALLOWED",
        earlyHintsWithoutLink: "ERR_HTTP2_INVALID_HEADER_VALUE",
        earlyHints: true,
        information: true,
      });
      // The blocks handed down: hint names trimmed and lowercased, then the link list, then the
      // status; writeInformation() passes its object through as given.
      expect(sentInfoHeaders).toEqual([
        ["x-hint", "Link", ":status"],
        ["x-undefined", "x-info", ":status"],
      ]);
      expect({ status, info, rstCode }).toEqual({
        status: 200,
        info: [
          ["x-hint", "h", "link", link],
          ["x-info", "i"],
        ],
        rstCode: 0,
      });
    } finally {
      client?.close();
      server.close();
    }
  });
});
