/**
 * node:http2 session options and SETTINGS parameters.
 *
 * node reads the SETTINGS parameters from `options.settings`, and the session limits from the top
 * level of the options. A key in the other place is ignored: it is not validated, and a SETTINGS
 * key does not go on the wire.
 *
 * Works with both:
 * - bun bd test test/js/node/http2/node-http2-session-options.test.ts
 * - node --experimental-strip-types --test test/js/node/http2/node-http2-session-options.test.ts
 */
import assert from "node:assert/strict";
import { once } from "node:events";
import http2 from "node:http2";
import net from "node:net";
import { after, before, describe, test } from "node:test";

const isBun = typeof Bun !== "undefined";

const PREFACE = Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n", "latin1");
const EMPTY_SETTINGS_FRAME = Buffer.from([0, 0, 0, 0x4, 0, 0, 0, 0, 0]);

let server: http2.Http2Server;
let port: number;

before(async () => {
  server = http2.createServer();
  server.on("stream", stream => {
    stream.respond({ ":status": 200 });
    stream.end("ok");
  });
  server.listen(0);
  await once(server, "listening");
  port = (server.address() as net.AddressInfo).port;
});

after(() => {
  server?.close();
});

/** The id to value entries of the first frame a server created with `options` sends. */
async function initialSettings(options: object): Promise<Record<number, number>> {
  const server = http2.createServer(options);
  server.listen(0);
  await once(server, "listening");
  const socket = net.connect((server.address() as net.AddressInfo).port, "127.0.0.1");
  try {
    await once(socket, "connect");
    socket.write(PREFACE);
    socket.write(EMPTY_SETTINGS_FRAME);
    let received = Buffer.alloc(0);
    for await (const chunk of socket) {
      received = Buffer.concat([received, chunk]);
      if (received.length >= 9 && received.length >= 9 + received.readUIntBE(0, 3)) break;
    }
    const length = received.readUIntBE(0, 3);
    assert.equal(received.readUInt8(3), 0x4, "the first frame is a SETTINGS frame");
    assert.equal(received.readUInt8(4) & 0x1, 0, "the first frame is not an ACK");
    const settings: Record<number, number> = {};
    for (let i = 9; i < 9 + length; i += 6) {
      settings[received.readUInt16BE(i)] = received.readUInt32BE(i + 2);
    }
    return settings;
  } finally {
    socket.destroy();
    server.close();
  }
}

describe("session options and SETTINGS parameters", () => {
  for (const [label, value] of [
    ["Infinity", Infinity],
    ["-1", -1],
    ["NaN", NaN],
    ["1.5", 1.5],
    ["2**53", 2 ** 53],
    ['"10"', "10"],
  ] as const) {
    test(`a top-level maxHeaderListSize of ${label} is ignored by createServer() and connect()`, async () => {
      const server = http2.createServer({ maxHeaderListSize: value } as any);
      server.on("stream", stream => {
        stream.respond({ ":status": 204 });
        stream.end();
      });
      server.listen(0);
      await once(server, "listening");
      let client: http2.ClientHttp2Session | undefined;
      try {
        client = http2.connect(`http://127.0.0.1:${(server.address() as net.AddressInfo).port}`, {
          maxHeaderListSize: value,
        } as any);
        const req = client.request({ ":path": "/" });
        req.end();
        const [headers] = await once(req, "response");
        assert.equal(headers[":status"], 204);
      } finally {
        client?.destroy();
        server.close();
      }
    });
  }

  test("the initial SETTINGS frame carries only the keys under options.settings", async () => {
    assert.deepEqual(
      await initialSettings({
        headerTableSize: 100,
        enablePush: true,
        maxConcurrentStreams: 7,
        initialWindowSize: 100000,
        maxFrameSize: 20000,
        maxHeaderListSize: 1000,
        maxHeaderSize: 1000,
        enableConnectProtocol: true,
        customSettings: { 1000: 5 },
      }),
      {},
    );
    assert.deepEqual(
      await initialSettings({ maxHeaderListSize: -1, settings: { maxHeaderListSize: 1000, maxConcurrentStreams: 7 } }),
      { 3: 7, 6: 1000 },
    );
  });

  test("a session limit applies at the top level of the options, not under options.settings", async () => {
    // 4 pseudo-headers and 10 regular headers: over a maxHeaderListPairs of 4.
    const headers: Record<string, string> = { ":path": "/" };
    for (let i = 0; i < 10; i++) headers[`x-header-${i}`] = "1";

    async function request(options: object) {
      const server = http2.createServer(options);
      server.on("stream", stream => {
        stream.respond({ ":status": 204 });
        stream.end();
      });
      server.listen(0);
      await once(server, "listening");
      const client = http2.connect(`http://127.0.0.1:${(server.address() as net.AddressInfo).port}`);
      client.on("error", () => {});
      try {
        const req = client.request(headers);
        req.end();
        const [response] = await once(req, "response");
        return response[":status"];
      } catch (err: any) {
        return err.code;
      } finally {
        client.destroy();
        server.close();
      }
    }

    assert.equal(await request({ settings: { maxHeaderListPairs: 4 } }), 204);
    assert.equal(await request({ maxHeaderListPairs: 4 }), "ERR_HTTP2_STREAM_ERROR");
  });

  for (const key of ["maxFrameSize", "initialWindowSize"]) {
    test(`connect(url, { ${key}: NaN }) serves a request`, async () => {
      const client = http2.connect(`http://127.0.0.1:${port}`, { [key]: NaN } as any);
      try {
        // The ACK comes first: with a frame size of 0 on the wire, request() never returns.
        await once(client, "localSettings");
        const req = client.request({ ":path": "/" });
        req.end();
        const [headers] = await once(req, "response");
        assert.equal(headers[":status"], 200);
        req.setEncoding("utf8");
        let body = "";
        for await (const chunk of req) body += chunk;
        assert.equal(body, "ok");
      } finally {
        client.destroy();
      }
    });
  }

  // Each getter gives validateSettings() a valid number and the native read NaN.
  // Bun-only: node v26.3.0 aborts on this input (an assertion in Http2Settings::Send()).
  function settingNanAfterValidation(key: string) {
    let armed = false;
    return {
      get [key]() {
        return armed ? NaN : 65535;
      },
      // validateSettings() reads customSettings after every other key.
      get customSettings() {
        armed = true;
        return undefined;
      },
    };
  }
  function customSettingNanAfterValidation() {
    let reads = 0;
    return {
      customSettings: {
        get 1000() {
          return reads++ === 0 ? 5 : NaN;
        },
      },
    };
  }
  for (const [label, nanAfterValidation] of [
    ["headerTableSize", () => settingNanAfterValidation("headerTableSize")],
    ["initialWindowSize", () => settingNanAfterValidation("initialWindowSize")],
    ["maxFrameSize", () => settingNanAfterValidation("maxFrameSize")],
    ["maxConcurrentStreams", () => settingNanAfterValidation("maxConcurrentStreams")],
    ["maxHeaderListSize", () => settingNanAfterValidation("maxHeaderListSize")],
    ["maxHeaderSize", () => settingNanAfterValidation("maxHeaderSize")],
    ["customSettings value", customSettingNanAfterValidation],
  ] as const) {
    test(`the native layer rejects a ${label} that becomes NaN after the JS validation`, { skip: !isBun }, async () => {
      function thrownCode(fn: () => void) {
        try {
          fn();
        } catch (err: any) {
          return err.code;
        }
      }

      const url = `http://127.0.0.1:${port}`;
      const client = http2.connect(url);
      client.on("error", () => {});
      // connect() throws from the session constructor, so the test owns the socket it would leave.
      const socket = net.connect(port, "127.0.0.1");
      socket.on("error", () => {});
      let second: http2.ClientHttp2Session | undefined;
      try {
        await Promise.all([once(client, "connect"), once(socket, "connect")]);
        assert.equal(
          thrownCode(() => client.settings(nanAfterValidation())),
          "ERR_HTTP2_INVALID_SETTING_VALUE",
        );
        assert.equal(
          thrownCode(() => {
            second = http2.connect(url, { createConnection: () => socket, settings: nanAfterValidation() });
            second.on("error", () => {});
          }),
          "ERR_HTTP2_INVALID_SETTING_VALUE",
        );
      } finally {
        second?.destroy();
        socket.destroy();
        client.destroy();
      }
    });
  }
});
