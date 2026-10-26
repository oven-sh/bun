// What a `type: "direct"` stream does with the value that its pull() or cancel() returns.
// The lifecycle matrix (every consumer, every way to end) is in direct-stream-contract.ts.
import { readableStreamToBytes, SQL } from "bun";
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { AsyncLocalStorage } from "node:async_hooks";
import { connect } from "node:net";
import { join } from "node:path";
import { delegating, lazy, type LazyPromise } from "./lazy-promise";

const later = () => new Promise<void>(resolve => setImmediate(resolve));
const decoder = new TextDecoder();
const text = (chunk: unknown) => (typeof chunk === "string" ? chunk : decoder.decode(chunk as Uint8Array));
// Bounded in turns of the event loop: a read that nothing answers is a failed assertion, not a timeout.
const noAnswer = async () => {
  for (let turn = 0; turn < 100; turn++) await later();
  return "no answer";
};
const settle = (promise: Promise<unknown>) =>
  promise.then(
    ok => ({ ok }),
    e => ({ err: e?.message ?? String(e) }),
  );
// A direct stream that counts its pull() calls. It closes at the ninth call: a reader calls pull()
// again when a call settles without a write, and a test must not run that loop without end.
function direct(pull: (controller: any, pulls: number) => unknown) {
  const tally = { pulls: 0 };
  const stream = new ReadableStream({
    type: "direct",
    pull: (controller: any) => (++tally.pulls > 8 ? void controller.close() : pull(controller, tally.pulls)),
  } as any);
  return { stream, tally };
}

describe("what pull() returns", () => {
  // The three places that call pull().
  const callers: [string, (stream: ReadableStream) => Promise<string>][] = [
    [
      "a reader",
      stream => {
        const read = async () => {
          let out = "";
          for await (const chunk of stream) out += text(chunk);
          return out;
        };
        return Promise.race([read(), noAnswer()]);
      },
    ],
    [
      "a native sink (Bun.write)",
      async stream => {
        using dir = tempDir("direct-pull-returns", {});
        const file = join(String(dir), "out.txt");
        await Bun.write(file, new Response(stream));
        return await Bun.file(file).text();
      },
    ],
    ["a buffer consumer (Bun.readableStreamToBytes)", async stream => text(await readableStreamToBytes(stream))],
  ];
  type Work = () => Promise<void>;
  type Counted = Promise<void> & { thenCalls: number };

  // A promise whose then() is not the built-in one is followed through then(): one call, from a job.
  describe.each<[string, (work: Work) => Counted]>([
    ["a pending promise that starts in then(), like Bun.$ or a Bun.sql query", work => lazy(work)],
    ["a pending promise whose own state never carries the result", work => delegating(work, { settled: false })],
    [
      "a promise that is fulfilled when it is made and works in then(), like p-lazy",
      work => delegating(work, { settled: true }),
    ],
  ])("%s", (_, make) => {
    test.each(callers)("%s calls then() once and waits for the work", async (_, consume) => {
      let returned: Counted | undefined;
      const { stream, tally } = direct(
        c =>
          (returned = make(async () => {
            c.write("a");
            await later();
            c.write("b");
            c.close();
          })),
      );
      expect({ body: await consume(stream), thenCalls: returned!.thenCalls, pulls: tally.pulls }).toEqual({
        body: "ab",
        thenCalls: 1,
        pulls: 1,
      });
    });
  });

  // A real value: the query only runs when something calls its then().
  test("a Bun.sql query that pull() returns runs, and the body ends when it resolves", async () => {
    await using sql = new SQL("sqlite://:memory:");
    await sql`create table pulls (body text)`;
    const stream = new ReadableStream({
      type: "direct",
      pull: (c: any) => (c.write("written"), sql`insert into pulls values ('written')`),
    } as any);
    expect({
      body: await Promise.race([new Response(stream).text(), noAnswer()]),
      rows: await sql`select body from pulls`,
    }).toEqual({ body: "written", rows: [{ body: "written" }] });
  });

  test("a reader calls then() once for each pull()", async () => {
    const returned: LazyPromise<void>[] = [];
    const { stream } = direct((c, pulls) => {
      const promise = lazy(async () => {
        await later();
        if (pulls < 3) c.write("chunk" + pulls);
        else c.close();
      });
      returned.push(promise);
      return promise;
    });
    const chunks: string[] = [];
    for await (const chunk of stream) chunks.push(text(chunk));
    expect({ chunks, thenCalls: returned.map(promise => promise.thenCalls) }).toEqual({
      chunks: ["chunk1", "chunk2"],
      thenCalls: [1, 1, 1],
    });
  });

  test.each(callers)("%s calls then() once on a plain promise that has its own then()", async (_, consume) => {
    let thenCalls = 0;
    const { stream, tally } = direct(c => {
      const promise: Promise<void> = (async () => {
        c.write("a");
        await later();
        c.write("b");
        c.close();
      })();
      promise.then = function (this: Promise<void>, onFulfilled: any, onRejected: any) {
        thenCalls++;
        return Promise.prototype.then.call(this, onFulfilled, onRejected);
      } as any;
      return promise;
    });
    expect({ body: await consume(stream), thenCalls, pulls: tally.pulls }).toEqual({
      body: "ab",
      thenCalls: 1,
      pulls: 1,
    });
  });

  // There is nothing to call, so the state of the promise is what there is to wait on.
  test.each(callers)("%s waits on the state of a promise whose then is not callable", async (_, consume) => {
    const { stream, tally } = direct(c => {
      const promise: Promise<void> = (async () => {
        c.write("a");
        await later();
        c.write("b");
        c.close();
      })();
      (promise as any).then = undefined;
      return promise;
    });
    expect({ body: await consume(stream), pulls: tally.pulls }).toEqual({ body: "ab", pulls: 1 });
  });

  test.each(callers)("%s: a then getter that throws fails the stream with what it threw", async (_, consume) => {
    const { stream } = direct(c => {
      c.write("a");
      // It rejects by itself one turn later, so a wait on its state ends too.
      const promise = later().then(() => {
        throw new Error("rejected by itself");
      });
      promise.catch(() => {});
      Object.defineProperty(promise, "then", {
        get() {
          throw new Error("then getter threw");
        },
      });
      return promise;
    });
    expect(await settle(consume(stream))).toEqual({ err: "then getter threw" });
  });

  test.each(callers)("%s: a then getter that closes the controller ends the stream there", async (_, consume) => {
    const calls: string[] = [];
    const { stream } = direct(c => {
      calls.push("pull");
      c.write("a");
      // It rejects one turn later. Only a stream that the getter closed does not fail with that.
      const promise = later().then(() => {
        throw new Error("rejected after the close");
      });
      promise.catch(() => {});
      Object.defineProperty(promise, "then", {
        get() {
          calls.push("then getter");
          c.close();
          return Promise.prototype.then;
        },
      });
      return promise;
    });
    expect({ result: await settle(consume(stream)), calls }).toEqual({
      result: { ok: "a" },
      calls: ["pull", "then getter"],
    });
  });

  // The rule for a consumer that takes the whole body: the body ends when the promise resolves.
  // A write that an event makes after that is not part of the body, as with an async pull().
  test.each(callers.slice(1))("%s ends the body when the followed promise resolves", async (_, consume) => {
    const bodies: Record<string, string> = {};
    for (const [name, returns] of [
      ["a promise that starts in then()", (wait: Work) => lazy(wait)],
      ["an async pull()", (wait: Work) => wait()],
    ] as const) {
      const wroteLate = Promise.withResolvers<void>();
      const { stream } = direct(c => {
        c.write("early");
        const resolved = Promise.withResolvers<void>();
        resolved.promise.then(later).then(() => {
          try {
            c.write(" late");
            c.close();
          } catch {}
          wroteLate.resolve();
        });
        return returns(async () => {
          await later();
          resolved.resolve();
        });
      });
      bodies[name] = await consume(stream);
      await wroteLate.promise;
    }
    expect(bodies).toEqual({ "a promise that starts in then()": "early", "an async pull()": "early" });
  });

  test("without pull(): a reader rejects, a buffer consumer rejects with its own message, a native sink gets an empty body", async () => {
    const make = () => new ReadableStream({ type: "direct" } as any);
    using dir = tempDir("direct-no-pull", {});
    const file = join(String(dir), "out.txt");
    await Bun.write(file, new Response(make()));
    expect({
      reader: await settle(make().getReader().read()),
      buffer: await settle(readableStreamToBytes(make()) as Promise<unknown>),
      sink: await Bun.file(file).text(),
    }).toEqual({
      reader: { err: "underlyingSource.pull is not a function" },
      buffer: { err: "The 'pull' method of a direct ReadableStream's underlying source is not a function" },
      sink: "",
    });
  });

  test("pull() runs in the async context of the stream for a reader, and of the caller for the other two", async () => {
    const als = new AsyncLocalStorage<string>();
    const seen: unknown[] = [];
    for (const [, consume] of callers) {
      const { stream } = als.run("the stream", () =>
        direct(c => {
          seen.push(als.getStore());
          c.write("a");
          c.close();
        }),
      );
      await als.run("the caller", () => consume(stream));
    }
    expect(seen).toEqual(["the stream", "the caller", "the caller"]);
  });

  // A follower for each result would be one more Promise for each read. The child runs with the
  // collector off, so a count is a number of allocations.
  test("a plain promise is used as it is: no Promise is allocated for it", async () => {
    const src = `
      const { heapStats } = require("bun:jsc");
      const READS = 4000;
      const chunk = new Uint8Array(1);
      const promises = () => heapStats().objectTypeCounts.Promise || 0;
      const drain = async reader => { while (!(await reader.read()).done) {} };
      const sources = {
        directPull: () => {
          let i = 0;
          return new ReadableStream({
            type: "direct",
            async pull(c) {
              await null;
              if (i++ < READS) c.write(chunk);
              else c.close();
            },
          });
        },
        generatorBody: () =>
          new Response((async function* () { for (let i = 0; i < READS; i++) yield chunk; })()).body,
      };
      const counts = {};
      for (const [name, make] of Object.entries(sources)) {
        await drain(make().getReader());
        const before = promises();
        await drain(make().getReader());
        counts[name] = (promises() - before) / READS;
      }
      const counted = promises();
      Bun.gc(true);
      counts.collected = counted - promises();
      console.log(JSON.stringify(counts));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: { ...bunEnv, BUN_JSC_useGC: "0" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const counts = stdout ? JSON.parse(stdout) : {};
    // For each read: the promise of read(), and for the direct stream the promise of its async pull().
    // A follower would add one to each. A count that is too high is shown as it is.
    expect({
      directPull: counts.directPull < 2.5 || counts.directPull,
      generatorBody: counts.generatorBody < 1.5 || counts.generatorBody,
      collected: counts.collected,
      stderr,
      exitCode,
    }).toEqual({ directPull: true, generatorBody: true, collected: 0, stderr: "", exitCode: 0 });
  });
});

// A native sink that closes underneath the source (here: the HTTP client leaves) calls cancel(reason).
// Nothing waits for what that cancel() returns.
describe("what cancel() returns after the sink closed", () => {
  // Reads the response up to "first" and drops the connection.
  async function abortAfterFirstChunk(server: Bun.Server<undefined>) {
    const socket = connect(server.port!, "127.0.0.1");
    let raw = "";
    await new Promise<void>((resolve, reject) => {
      socket.on("connect", () => socket.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n"));
      socket.on("data", data => (raw += data.toString("latin1")).includes("first") && resolve());
      socket.on("error", reject);
      socket.on("close", () => reject(new Error("the response ended before its first chunk")));
    });
    socket.destroy();
  }
  const parked = (cancel: () => unknown) =>
    new ReadableStream({
      type: "direct",
      async pull(c: any) {
        c.write("first");
        await c.flush();
        await new Promise(() => {});
      },
      cancel,
    } as any);

  // Bun.$ and a Bun.sql query start in then(): a cleanup that returns one still has to run.
  test("a promise that starts in then() is started: then() is called once", async () => {
    let returned: LazyPromise<string> | undefined;
    const cancelled = Promise.withResolvers<void>();
    const stream = parked(() => {
      returned = lazy(() => "cleanup ran");
      cancelled.resolve();
      return returned;
    });
    using server = Bun.serve({ port: 0, fetch: () => new Response(stream) });
    await abortAfterFirstChunk(server);
    await cancelled.promise;
    // A wait on the state: an `await` here would be the then() call.
    const outcome = await new Promise(resolve =>
      Promise.prototype.then.call(returned, resolve, (e: Error) => resolve(e.message)),
    );
    expect({ outcome, thenCalls: returned!.thenCalls }).toEqual({ outcome: "cleanup ran", thenCalls: 1 });
  });

  test("a throw is an uncaught exception, and no rejection is reported", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const { connect } = require("node:net");
        const { lazy } = require(${JSON.stringify(join(import.meta.dir, "lazy-promise.ts"))});
        const later = () => new Promise(resolve => setImmediate(resolve));
        const out = {};
        let reports;
        process.on("uncaughtException", e => reports.push("uncaughtException: " + e.message));
        process.on("unhandledRejection", e => reports.push("unhandledRejection: " + e.message));
        const rejectsLater = () => later().then(() => { throw new Error("cleanup failed"); });
        for (const [name, cancel] of [
          ["throws", () => { throw new Error("cancel threw"); }],
          ["returns a rejected promise", () => Promise.reject(new Error("cleanup failed"))],
          ["returns a promise that starts in then() and rejects", () => lazy(rejectsLater)],
          ["returns a promise that rejects later and whose then getter throws", () =>
            Object.defineProperty(rejectsLater(), "then", { get() { throw new Error("then getter threw"); } })],
        ]) {
          reports = [];
          const cancelled = Promise.withResolvers();
          const server = Bun.serve({
            port: 0,
            fetch: () => new Response(new ReadableStream({
              type: "direct",
              async pull(c) {
                c.write("first");
                await c.flush();
                await new Promise(() => {});
              },
              cancel() {
                cancelled.resolve();
                return cancel();
              },
            })),
          });
          const socket = connect(server.port, "127.0.0.1");
          let raw = "";
          await new Promise((resolve, reject) => {
            socket.on("connect", () => socket.write("GET / HTTP/1.1\\r\\nHost: x\\r\\n\\r\\n"));
            socket.on("data", data => (raw += data.toString("latin1")).includes("first") && resolve());
            socket.on("error", reject);
            socket.on("close", () => reject(new Error("the response ended before its first chunk")));
          });
          socket.destroy();
          await cancelled.promise;
          for (let i = 0; i < 4; i++) await later();
          out[name] = reports;
          server.stop(true);
        }
        console.log(JSON.stringify(out));
        process.exit(0);
        `,
      ],
      env: bunEnv,
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, reports: stdout && JSON.parse(stdout), exitCode }).toEqual({
      stderr: "",
      reports: {
        "throws": ["uncaughtException: cancel threw"],
        "returns a rejected promise": [],
        "returns a promise that starts in then() and rejects": [],
        "returns a promise that rejects later and whose then getter throws": [],
      },
      exitCode: 0,
    });
  });
});
