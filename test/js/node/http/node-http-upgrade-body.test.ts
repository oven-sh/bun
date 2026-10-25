import { beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isWindows, tempDir } from "harness";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import type { Duplex } from "node:stream";
import { promisify } from "node:util";

// The close of a tunnel gave the request body handler one more last chunk, also when the parser had given it one.
// From inside the delivery of that last chunk, the second one killed the process: "Segmentation fault at address
// 0x30", under ASAN "JSCast.h:182 member call on null pointer of type 'JSC::JSCell'".
describe("an Upgrade request with a body", () => {
  const fixture = path.join(import.meta.dir, "node-http-upgrade-body-fixture.js");
  const nativeLog = "[nodehttpresponse] ";

  type Options = Record<string, unknown>;

  // Runs the rows in order in one child. The fixture prints one JSON line per row.
  async function run(rows: Options[], env: Record<string, string | undefined> = bunEnv) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), fixture, JSON.stringify(rows)],
      env,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const lines = stdout.split("\n").filter(Boolean);
    return {
      rows: lines.filter(line => !line.startsWith(nativeLog)).map(line => JSON.parse(line)),
      native: lines.filter(line => line.startsWith(nativeLog)).map(line => line.slice(nativeLog.length)),
      stderr,
      exitCode,
      signalCode: proc.signalCode,
    };
  }

  const exited = { stderr: "", exitCode: 0, signalCode: null };
  const ended = ["req data 100", "req end", "req close"];
  // As in Node.js, the whole body is parsed when 'upgrade' is emitted, so the request has its EOF by then.
  const destroyed = (read: string) => [`req ${read} 100`, "req aborted", "req end", "req close", "socket close"];

  describe("gets its EOF once when the listener lets go inside the last chunk", () => {
    const rows: [name: string, options: Options, expected: { events: string[]; eofs: number }][] = [
      ["req.destroy() in 'data'", { act: "req.destroy()" }, { events: destroyed("data"), eofs: 0 }],
      [
        "req.destroy() in 'readable'",
        { act: "req.destroy()", read: "readable" },
        { events: destroyed("readable"), eofs: 0 },
      ],
      ["req.destroy() over TLS", { act: "req.destroy()", secure: true }, { events: destroyed("data"), eofs: 0 }],
      [
        "req.destroy(err)",
        { act: "req.destroy(err)" },
        {
          events: ["req data 100", "req aborted", "socket error: stop", "req error: stop", "req close", "socket close"],
          eofs: 0,
        },
      ],
      [
        "socket.destroy(), then req.destroy()",
        { act: "socket.destroy() then req.destroy()" },
        { events: destroyed("data"), eofs: 0 },
      ],
      [
        "req.destroy(), then a throw",
        { act: "req.destroy() then throw" },
        {
          events: [
            "req data 100",
            "req aborted",
            "uncaughtException: listener threw",
            "req end",
            "req close",
            "socket close",
          ],
          eofs: 0,
        },
      ],
      [
        "req.destroy() at the end of a body that took two reads",
        { act: "req.destroy()", split: true },
        { events: ["req data 50", "req data 50", "req aborted", "req close", "socket close"], eofs: 1 },
      ],
      ["socket.destroy()", { act: "socket.destroy()" }, { events: [...ended, "socket close"], eofs: 0 }],
      [
        "socket.resetAndDestroy()",
        { act: "socket.resetAndDestroy()" },
        { events: [...ended, "socket close"], eofs: 0 },
      ],
      ["socket.destroySoon()", { act: "socket.destroySoon()" }, { events: [...ended, "socket close"], eofs: 0 }],
    ];

    let shared: ReturnType<typeof run>;
    let spilled: ReturnType<typeof run>;
    beforeAll(() => {
      shared = run(rows.map(([, options]) => options));
      // Gets its own child. After other rows ran in the same process, this row rarely hits the crash it guards against.
      spilled = run([{ act: "req.destroy()", read: "readable", secure: true, spill: true }]);
    });

    rows.forEach(([name, , expected], i) => {
      test(name, async () => {
        expect((await shared).rows[i]).toEqual(expected);
      });
    });
    test("the child that ran these rows exits cleanly", async () => {
      expect(await shared).toEqual({ rows: expect.any(Array), native: [], ...exited });
    });
    test("req.destroy() in 'readable', while a TLS write that spilled defers the close", async () => {
      expect(await spilled).toEqual({ rows: [{ events: destroyed("readable"), eofs: 0 }], native: [], ...exited });
    });
  });

  // Only a debug build prints what uws gives to the body handler of the request.
  describe.skipIf(!isDebug)("gets nothing from uws after its last chunk", () => {
    const rows: [name: string, options: Options, events: string[]][] = [
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
        const result = await run([options], { ...bunEnv, BUN_DEBUG: "", BUN_DEBUG_NodeHTTPResponse: "1" });
        const native = result.native.filter(line => line.startsWith("onData("));
        expect({ ...result, native }).toEqual({
          rows: [{ events, eofs: 0 }],
          native: ["onData(100 bytes, is_last = 1)"],
          ...exited,
        });
      });
    }
  });

  describe.each(["tcp", "unix"] as const)("over %s", door => {
    const head = "GET / HTTP/1.1\r\nHost: a\r\nConnection: Upgrade\r\nUpgrade: x\r\nContent-Length: 8\r\n\r\n";

    // The 'upgrade' listener only reads. Resolves with the connected client and the stream that the listener got.
    async function upgrade(firstWrite: string) {
      const events: string[] = [];
      const dir = tempDir("upgrade-body", {});
      const server = http.createServer();
      const upgraded = Promise.withResolvers<Duplex>();
      server.on("upgrade", (req, stream) => {
        for (const event of ["end", "finish", "error", "close"]) {
          req.socket.on(event, () => events.push(`socket ${event}`));
          stream.on(event, () => events.push(`stream ${event}`));
        }
        stream.resume();
        upgraded.resolve(stream);
      });
      await once(
        door === "unix" ? server.listen(path.join(String(dir), "s")) : server.listen(0, "127.0.0.1"),
        "listening",
      );
      const address = server.address();
      const client = typeof address === "string" ? net.connect(address) : net.connect(address!.port, "127.0.0.1");
      client.on("error", () => {});
      client.write(firstWrite);
      return {
        events,
        server,
        client,
        stream: await upgraded.promise,
        [Symbol.dispose]() {
          client.destroy();
          server.closeAllConnections();
          server.close();
          dir[Symbol.dispose]();
        },
      };
    }

    test.skipIf(isWindows && door === "unix").each(["destroy()", "end()"])(
      "the socket ends and closes when the client leaves with %s before the body has ended",
      async how => {
        using connection = await upgrade(head + "half");
        const { client, server, stream, events } = connection;
        const closed = once(stream, "close");
        if (how === "end()") client.resume().end();
        else client.destroy();
        await closed;
        expect(events).toEqual(["socket end", "stream end", "socket finish", "socket close", "stream close"]);
        expect(await promisify(server.getConnections).call(server)).toBe(0);
        await promisify(server.close).call(server);
      },
    );

    test.skipIf(isWindows && door === "unix")(
      "the socket stays the listener's when the client half-closes after the body has ended",
      async () => {
        using connection = await upgrade(head + "half");
        const { client, stream, events } = connection;
        const ended = once(stream, "end");
        client.end("half");
        await ended;
        stream.end("still open");
        expect((await client.toArray()).join("")).toBe("still open");
        expect(events.slice(0, 2)).toEqual(["socket end", "stream end"]);
      },
    );
  });
});
