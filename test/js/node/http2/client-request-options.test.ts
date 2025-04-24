import { describe, expect, test } from "bun:test";
import http2 from "node:http2";

function serverReady(server: http2.Http2Server): Promise<number> {
  return new Promise(resolve => server.listen(0, () => resolve((server.address() as any).port)));
}

function sessionReady(session: http2.ClientHttp2Session): Promise<void> {
  return new Promise(resolve => session.on("connect", () => resolve()));
}

describe("ClientHttp2Session.request invalid options types", () => {
  const invalidOptions: Array<[string, any]> = [
    ["endStream", "notBoolean"],
    ["weight", "notNumber"],
    ["parent", {}],
    ["exclusive", 123],
    ["silent", null],
  ];

  for (const [prop, value] of invalidOptions) {
    test(`throws ERR_INVALID_ARG_TYPE when option ${prop} is ${typeof value}`, async () => {
      const server = http2.createServer(() => {
        // noop
      });
      const port = await serverReady(server);
      const session = http2.connect(`http://localhost:${port}`);
      await sessionReady(session);

      expect(() => {
        session.request({ ":method": "GET", ":authority": `localhost:${port}` }, { [prop]: value });
      }).toThrow(TypeError);

      session.close();
      server.close();
    });
  }
});

describe("ClientHttp2Session.request valid options", () => {
  test("accepts correct types and returns a stream", async () => {
    const server = http2.createServer(() => {
      // noop
    });

    const port = await serverReady(server);
    const session = http2.connect(`http://localhost:${port}`);
    await sessionReady(session);

    const opts = {
      endStream: false,
      weight: 1,
      parent: 0,
      exclusive: true,
      silent: false,
    };

    const req = session.request({ ":method": "GET", ":authority": `localhost:${port}` }, opts);
    expect(req).toBeTruthy();

    session.close();
    server.close();
  });
});
