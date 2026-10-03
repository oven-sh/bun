import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isWindows, tempDir } from "harness";
import path from "node:path";

// The close of a tunnel gave the request body handler one more last chunk, also when the parser had given it one.
// From inside the delivery of that last chunk, the second one killed the process: "Segmentation fault at address
// 0x30", under ASAN "JSCast.h:182 member call on null pointer of type 'JSC::JSCell'".
describe("an Upgrade request with a body", () => {
  const fixture = path.join(import.meta.dir, "node-http-upgrade-body-fixture.js");
  const nativeLog = "[nodehttpresponse] ";

  async function run(
    options: Record<string, unknown>,
    env: Record<string, string | undefined> = bunEnv,
    script = fixture,
  ) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), script, JSON.stringify(options)],
      env,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const lines = stdout.split("\n").filter(Boolean);
    const printed = lines.filter(line => !line.startsWith(nativeLog));
    return {
      // What the fixture printed, or the output of a child that died before it could.
      ...(printed.length === 1 && printed[0].startsWith("{") ? JSON.parse(printed[0]) : { stdout }),
      native: lines.filter(line => line.startsWith(nativeLog)).map(line => line.slice(nativeLog.length)),
      stderr,
      exitCode,
      signalCode: proc.signalCode,
    };
  }

  const exited = { stderr: "", exitCode: 0, signalCode: null };
  const ended = ["req data 100", "req end", "req close"];
  // Node.js v26.3.0 emits 'end' before this 'close': it has parsed the whole body when it emits 'upgrade'.
  const destroyed = (read: string) => [`req ${read} 100`, "req aborted", "req close", "socket close"];

  describe("gets its EOF once when the listener lets go inside the last chunk", () => {
    const rows: [name: string, options: Record<string, unknown>, expected: { events: string[]; eofs: number }][] = [
      ["req.destroy() in 'data'", { act: "req.destroy()" }, { events: destroyed("data"), eofs: 1 }],
      [
        "req.destroy() in 'readable'",
        { act: "req.destroy()", read: "readable" },
        { events: destroyed("readable"), eofs: 1 },
      ],
      ["req.destroy() over TLS", { act: "req.destroy()", secure: true }, { events: destroyed("data"), eofs: 1 }],
      [
        "req.destroy(err)",
        { act: "req.destroy(err)" },
        {
          events: ["req data 100", "req aborted", "req error: stop", "req close", "socket error: stop", "socket close"],
          eofs: 1,
        },
      ],
      [
        "socket.destroy(), then req.destroy()",
        { act: "socket.destroy() then req.destroy()" },
        { events: destroyed("data"), eofs: 1 },
      ],
      [
        "req.destroy(), then a throw",
        { act: "req.destroy() then throw" },
        {
          events: ["req data 100", "req aborted", "uncaughtException: listener threw", "req close", "socket close"],
          // The throw leaves the callback before it gives the request its EOF.
          eofs: 0,
        },
      ],
      [
        "req.destroy() at the end of a body that took two reads",
        { act: "req.destroy()", split: true },
        { events: ["req data 50", "req data 50", "req aborted", "req close", "socket close"], eofs: 1 },
      ],
      ["socket.destroy()", { act: "socket.destroy()" }, { events: [...ended, "socket close"], eofs: 1 }],
      [
        "socket.resetAndDestroy()",
        { act: "socket.resetAndDestroy()" },
        { events: [...ended, "socket close"], eofs: 1 },
      ],
      [
        "socket.destroySoon()",
        { act: "socket.destroySoon()" },
        { events: [...ended, "socket end", "socket close"], eofs: 1 },
      ],
      [
        "req.destroy() in 'readable', while a TLS write that spilled defers the close",
        { act: "req.destroy()", read: "readable", secure: true, spill: true },
        { events: destroyed("readable"), eofs: 1 },
      ],
    ];
    for (const [name, options, expected] of rows) {
      test.concurrent(name, async () => {
        expect(await run(options)).toMatchObject({ ...expected, ...exited });
      });
    }
  });

  // Node.js v26.3.0 still has socketOnEnd on that connection, and it ends the socket. The server made the connection a
  // half-open tunnel: the socket emitted no 'close', server.close() did not complete, and a later write went out.
  describe("gets its socket ended and closed when the client ends inside the body", () => {
    const finFixture = path.join(import.meta.dir, "node-http-upgrade-body-fin-fixture.js");
    const size = 8 * 1024 * 1024;
    const end = "socket end, writable: true";
    // Node.js emits "server close" before "socket error": its raw socket closes before the stream that wraps it.
    const closed = ["socket close", "server close"];
    // What a write in 'end' of the socket gets. Over TLS, Node.js fails it with EPIPE.
    const refused = [
      "late write: ERR_STREAM_WRITE_AFTER_END",
      "clientError: ERR_STREAM_WRITE_AFTER_END",
      "socket error: ERR_STREAM_WRITE_AFTER_END",
    ];
    const rows: [name: string, options: Record<string, unknown>, expected: { events: string[]; received?: number }][] = [
      ["after 7 of its 100 bytes", {}, { events: [end, ...refused, ...closed], received: 0 }],
      ["before its first byte", { sent: 0 }, { events: [end, ...refused, ...closed], received: 0 }],
      ["inside a chunk", { chunked: true }, { events: [end, ...refused, ...closed], received: 0 }],
      ["in the write that carries the head", { finWithHead: true }, { events: [end, ...refused, ...closed], received: 0 }],
      ["with httpAllowHalfOpen", { httpAllowHalfOpen: true }, { events: [end, ...refused, ...closed], received: 0 }],
      ["over TLS", { secure: true, inEnd: "none" }, { events: [end, ...closed], received: 0 }],
      ["while the listener has paused the socket", { pause: true }, { events: [end, ...refused, ...closed], received: 0 }],
      [
        "and the listener ends the socket in 'end'",
        { inEnd: "end" },
        { events: [end, "socket finish", ...closed], received: 0 },
      ],
      [
        "after the bytes that the listener wrote",
        { queued: size },
        { events: [end, "queued write: sent", ...refused, ...closed], received: size },
      ],
      [
        "after the bytes that the listener wrote, over TLS",
        { queued: size, secure: true, inEnd: "none" },
        { events: [end, "queued write: sent", ...closed], received: size },
      ],
      // Those bytes waited for the client's FIN: nothing sent them while the body still arrived.
      [
        "when it has the bytes that the listener wrote",
        { queued: size, finAfterQueued: true },
        { events: ["queued write: sent", end, ...refused, ...closed], received: size },
      ],
      // A tunnel stays half-open: the listener ends it.
      ["never, when the client ends after the body", { sent: 100 }, { events: [end, "late write: sent"] }],
    ];
    for (const [name, options, expected] of rows) {
      test.concurrent(name, async () => {
        expect(await run(options, bunEnv, finFixture)).toMatchObject({ ...expected, ...exited });
      });
    }

    test.concurrent.skipIf(isWindows)("on a unix socket", async () => {
      using dir = tempDir("upgrade-body-fin", {});
      const result = await run({ unix: path.join(String(dir), "http.sock") }, bunEnv, finFixture);
      expect(result).toMatchObject({ events: [end, ...refused, ...closed], received: 0, ...exited });
    });
  });

  // Only a debug build prints what uws gives to the body handler of the request.
  describe.skipIf(!isDebug)("gets nothing from uws after its last chunk", () => {
    const rows: [name: string, options: Record<string, unknown>, events: string[]][] = [
      ["the close of the socket inside that chunk", { act: "socket.destroy()" }, [...ended, "socket close"]],
      [
        "bytes of the tunnel after socket.end() inside that chunk",
        { act: "socket.end()", tunnelBytes: "0123456789" },
        // The upgrade socket got the bytes, so uws did read them.
        [...ended, "socket data 10", "socket end", "socket close"],
      ],
    ];
    for (const [name, options, events] of rows) {
      test.concurrent(name, async () => {
        // A BUN_DEBUG from the shell of the developer sends the log to a file. An empty one keeps it on stdout.
        const result = await run(options, { ...bunEnv, BUN_DEBUG: "", BUN_DEBUG_NodeHTTPResponse: "1" });
        const native = result.native.filter(line => line.startsWith("onData("));
        expect({ ...result, native }).toMatchObject({
          events,
          eofs: 1,
          native: ["onData(100 bytes, is_last = 1)"],
          ...exited,
        });
      });
    }
  });
});
