// https://github.com/oven-sh/bun/issues/30307

import { describe, expect, it } from "bun:test";
import { isASAN } from "harness";
import { once } from "node:events";
import http2 from "node:http2";

const SCALE = isASAN ? 4 : 1;

describe("#30307", () => {
  it("req.setTimeout does not fire on completed streams after a session-idle gap", async () => {
    const server = http2.createServer();
    server.on("stream", stream => {
      stream.respond({ ":status": 200 });
      stream.end("ok");
    });

    const listening = once(server, "listening");
    server.listen(0);
    await listening;
    const port = (server.address() as import("node:net").AddressInfo).port;
    const client = http2.connect(`http://localhost:${port}`);
    try {
      await once(client, "connect");
      {
        const warmup = client.request({ ":path": "/" });
        warmup.resume();
        warmup.end();
        await once(warmup, "end");
      }

      const STREAM_TIMEOUT_MS = 150 * SCALE;
      const IDLE_BARRIER_MS = 2 * STREAM_TIMEOUT_MS;

      const timeoutFires: string[] = [];
      async function doRequest(label: string) {
        const req = client.request({ ":path": "/" });
        req.setTimeout(STREAM_TIMEOUT_MS, () => {
          timeoutFires.push(label);
        });
        req.resume();
        req.end();
        await once(req, "end");
      }

      await doRequest("req-1");
      await doRequest("req-2");
      await doRequest("req-3");
      await doRequest("req-4");

      client.setTimeout(IDLE_BARRIER_MS);
      await once(client, "timeout");

      await doRequest("req-5");

      expect(timeoutFires).toEqual([]);
    } finally {
      client.close();
      server.close();
    }
  });

  it("session-level setTimeout does not emit 'timeout' on live streams", async () => {
    const server = http2.createServer();
    server.on("stream", _stream => {});

    const listening = once(server, "listening");
    server.listen(0);
    await listening;
    const port = (server.address() as import("node:net").AddressInfo).port;
    const client = http2.connect(`http://localhost:${port}`);
    try {
      await once(client, "connect");

      const streamFired: string[] = [];
      const req1 = client.request({ ":path": "/a" });
      const req2 = client.request({ ":path": "/b" });
      req1.on("error", () => {});
      req2.on("error", () => {});
      req1.on("timeout", () => streamFired.push("req1"));
      req2.on("timeout", () => streamFired.push("req2"));
      req1.end();
      req2.end();

      client.setTimeout(150 * SCALE);
      await once(client, "timeout");

      expect(streamFired).toEqual([]);

      req1.close(http2.constants.NGHTTP2_CANCEL);
      req2.close(http2.constants.NGHTTP2_CANCEL);
    } finally {
      client.close();
      server.close();
    }
  });

  it("req.setTimeout does not fire on a completed stream whose body is never read", async () => {
    const server = http2.createServer();
    server.on("stream", stream => {
      stream.respond({ ":status": 200 });
      stream.end("a response body the client never reads");
    });

    const listening = once(server, "listening");
    server.listen(0);
    await listening;
    const port = (server.address() as import("node:net").AddressInfo).port;
    const client = http2.connect(`http://localhost:${port}`);
    try {
      await once(client, "connect");

      const fired: string[] = [];
      const req = client.request({ ":path": "/" });
      req.on("error", () => {});
      req.setTimeout(150 * SCALE, () => fired.push("req"));
      req.end();

      client.setTimeout(2 * 150 * SCALE);
      await once(client, "timeout");

      expect(fired).toEqual([]);
    } finally {
      client.close();
      server.close();
    }
  });
});
