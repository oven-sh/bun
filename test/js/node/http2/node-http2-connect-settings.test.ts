import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { bunEnv, bunExe, isDebug, nodeExe, tls as TLS_CERT } from "harness";
import path from "node:path";
import { start } from "./http2-connect-settings.fixture.js";

// node reads options.settings in setupHandle, which runs when the socket connects. It ignores a
// value whose typeof is not "object". null, an array, or a value that validation rejects
// destroys the session with that error. connect() throws in two cases only. The socket is
// already connected, so setupHandle runs inline. Or the URL is https and there is no
// createConnection: node then checks options.settings before it makes the socket.
describe("http2.connect reports a rejected options.settings where Node.js does", () => {
  const sessionError = (code: string, message: string) => ({
    events: [`error ${code}: ${message}`, "close"],
    request: `ERR_HTTP2_STREAM_CANCEL caused by ${code}`,
  });
  const notAnObject = (received: string) =>
    sessionError("ERR_INVALID_ARG_TYPE", `The "settings" argument must be of type object. Received ${received}`);
  const notAnObjectProperty = (received: string) => ({
    thrown: `ERR_INVALID_ARG_TYPE: The "options.settings" property must be of type object. Received ${received}`,
  });
  const invalidValue = [
    "ERR_HTTP2_INVALID_SETTING_VALUE",
    'Invalid value for setting "initialWindowSize": -1',
  ] as const;
  const ignored = { events: ["listener", "connect", "close"], request: "status 200" };
  const expected = {
    createConnection: {
      "connecting socket": sessionError(...invalidValue),
      "connected socket": { thrown: invalidValue.join(": ") },
      "https null": notAnObject("null"),
    },
    http: {
      "null": notAnObject("null"),
      "array": notAnObject("an instance of Array"),
      "invalid": sessionError(...invalidValue),
      "invalid, closed with a request pending": sessionError(...invalidValue),
      "invalid, closed with nothing pending": { errors: [] },
      "invalid, closed after its request was destroyed": { errors: [] },
      "number": ignored,
      "string": ignored,
      "boolean": ignored,
      "function": ignored,
    },
    https: {
      "null": notAnObjectProperty("null"),
      "array": notAnObjectProperty("an instance of Array"),
      "number": notAnObjectProperty("type number (1)"),
      "invalid": sessionError(...invalidValue),
    },
  };

  describe("Bun", () => {
    let fixture: Awaited<ReturnType<typeof start>>;
    beforeAll(async () => {
      fixture = await start(TLS_CERT);
    });
    afterAll(() => fixture?.close());

    for (const group of ["createConnection", "http", "https"] as const) {
      it(group, async () => {
        expect(await fixture[group]()).toEqual(expected[group]);
      });
    }
  });

  it.skipIf(!nodeExe())("Node.js", async () => {
    const fixture = path.join(import.meta.dir, "http2-connect-settings.fixture.js");
    await using proc = Bun.spawn({
      cmd: [nodeExe()!, fixture, JSON.stringify(TLS_CERT)],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(JSON.parse(stdout)).toEqual(expected);
    expect(exitCode).toBe(0);
  });

  // With no 'error' listener the destroy throws. A throw from inside the socket's connect callback
  // is reported on the socket, so the connect handler throws it again from the next tick.
  const noErrorListener = `
    const http2 = require("node:http2");
    const server = http2.createServer();
    server.listen(0, "127.0.0.1", () => {
      process.on("uncaughtException", e => {
        console.log("uncaughtException " + e.code);
        process.exit(0);
      });
      http2.connect("http://127.0.0.1:" + server.address().port, { settings: { initialWindowSize: -1 } });
      console.log("connect() returned");
    });
  `;
  for (const [runtime, exe, skip] of [
    // A debug build needs several seconds to load node:http2 in a child, most of the default timeout.
    ["Bun", bunExe(), isDebug],
    ["Node.js", nodeExe(), !nodeExe()],
  ] as const) {
    it.skipIf(skip)(`with no 'error' listener the error is an uncaught exception (${runtime})`, async () => {
      await using proc = Bun.spawn({
        cmd: [exe!, "-e", noErrorListener],
        env: bunEnv,
        stdout: "pipe",
        stderr: "inherit",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect(stdout).toBe("connect() returned\nuncaughtException ERR_HTTP2_INVALID_SETTING_VALUE\n");
      expect(exitCode).toBe(0);
    });
  }
});
