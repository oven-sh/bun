import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug } from "harness";
import path from "node:path";

// The close of a tunnel gave the request body handler one more last chunk, also when the parser had given it one.
// From inside the delivery of that last chunk, the second one killed the process: "Segmentation fault at address
// 0x30", under ASAN "JSCast.h:182 member call on null pointer of type 'JSC::JSCell'".
describe("an Upgrade request with a body", () => {
  const fixture = path.join(import.meta.dir, "node-http-upgrade-body-fixture.js");
  const nativeLog = "[nodehttpresponse] ";
  // Ends the children that are still alive when the tests are done: one whose test a filter left out, or one that
  // never printed its row. A generator that waits for the output of its child cannot end that child.
  const leftover = new AbortController();
  afterAll(() => leftover.abort());

  type Options = Record<string, unknown>;
  type Row = { events: string[]; eofs: number };
  type Exit = { native: string[]; stdout: string; stderr: string; exitCode: number; signalCode: string | null };
  const exited: Exit = { native: [], stdout: "", stderr: "", exitCode: 0, signalCode: null };

  // One child runs the rows in order: a row costs a connection, not a process. Yields each row when the child prints
  // it. A row that the child does not print gets how the child ended: its exit, or the error that stopped it or kept
  // it from starting. A new child runs the rows after that row. Last, yields how the last child ended.
  async function* run(rows: Options[], env: Record<string, string | undefined> = bunEnv): AsyncGenerator<unknown> {
    let end: unknown = exited;
    for (let printed = 0; printed < rows.length; ) {
      try {
        await using proc = Bun.spawn({
          cmd: [bunExe(), fixture, JSON.stringify(rows.slice(printed))],
          env,
          stdout: "pipe",
          stderr: "pipe",
          stdin: "ignore",
          signal: leftover.signal,
        });
        const stderr = proc.stderr.text();
        const native: string[] = [];
        let stdout = "";
        for await (const chunk of proc.stdout.pipeThrough(new TextDecoderStream())) {
          const lines = (stdout + chunk).split("\n");
          stdout = lines.pop()!;
          for (const line of lines) {
            if (line.startsWith(nativeLog)) {
              native.push(line.slice(nativeLog.length));
            } else {
              const row = JSON.parse(line);
              printed++;
              yield row;
            }
          }
        }
        end = { native, stdout, stderr: await stderr, exitCode: await proc.exited, signalCode: proc.signalCode };
      } catch (error) {
        end = error;
      }
      if (printed < rows.length) {
        printed++;
        yield end;
      }
    }
    yield end;
  }

  const ended = ["req data 100", "req end", "req close"];
  // Node.js v26.3.0 emits 'end' before this 'close': it has parsed the whole body when it emits 'upgrade'.
  const destroyed = (read: string) => [`req ${read} 100`, "req aborted", "req close", "socket close"];

  describe("gets its EOF once when the listener lets go inside the last chunk", () => {
    const rows: [name: string, options: Options, expected: Row][] = [
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
    ];

    // Not concurrent: one child runs the rows in this order. Test i takes result i, also when a filter leaves out the
    // tests before it. A retry of a test reads the same result again: it does not run the row again.
    const child = run(rows.map(([, options]) => options));
    const results: Promise<IteratorResult<unknown>>[] = [];
    async function result(i: number) {
      while (results.length <= i) results.push(child.next());
      return (await results[i]).value;
    }

    rows.forEach(([name, , expected], i) => {
      test(name, async () => expect(await result(i)).toEqual(expected));
    });
    test("the child that ran these rows exits on its own", async () => {
      expect(await result(rows.length)).toEqual(exited);
    });

    // This row keeps a child of its own, which starts with the block and runs next to the child above. Without the
    // `on_read_parsed` test for a closed response, the row crashes in only some of its runs, and in almost none when
    // the child ran other rows first. If a test above times out while this child still runs, the runner ends this
    // child too.
    let alone: Promise<unknown[]>;
    beforeAll(() => {
      alone = Array.fromAsync(run([{ act: "req.destroy()", read: "readable", secure: true, spill: true }]));
    });
    test("req.destroy() in 'readable', while a TLS write that spilled defers the close", async () => {
      expect(await alone).toEqual([{ events: destroyed("readable"), eofs: 1 }, exited]);
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
        const env = { ...bunEnv, BUN_DEBUG: "", BUN_DEBUG_NodeHTTPResponse: "1" };
        const [row, end] = (await Array.fromAsync(run([options], env))) as [unknown, Partial<Exit>];
        expect([row, { ...end, native: end.native?.filter(line => line.startsWith("onData(")) }]).toEqual([
          { events, eofs: 1 },
          { ...exited, native: ["onData(100 bytes, is_last = 1)"] },
        ]);
      });
    }
  });
});
