import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The 'http.client.request' trace span must be closed on every terminal path,
// including ones that never reach the parser or the emitErrorEvent funnel.
test("http.client.request span is closed when the proxy CONNECT tunnel fails", async () => {
  using dir = tempDir("trace-events-proxy", {
    // A fake proxy that rejects the CONNECT with 502 -> ERR_PROXY_TUNNEL on the request.
    "main.mjs": `
      import net from "node:net";
      import https from "node:https";
      const proxy = net.createServer(s => {
        s.once("data", () => { s.end("HTTP/1.1 502 Bad Gateway\\r\\n\\r\\n"); });
      });
      proxy.listen(0, "127.0.0.1", () => {
        const agent = new https.Agent({
          proxyEnv: { HTTPS_PROXY: \`http://127.0.0.1:\${proxy.address().port}\` },
        });
        const r = https.request({ host: "example.invalid", port: 443, path: "/", agent });
        r.on("error", e => { console.log("errored", e.code); proxy.close(); });
        r.end();
      });
    `,
  });
  const traceFile = join(String(dir), "node_trace.log");

  await using proc = Bun.spawn({
    cmd: [bunExe(), "--trace-event-categories", "node.http", "--trace-event-file-pattern", traceFile, "main.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // The scenario must actually have happened for the assertion below to mean anything.
  expect(stdout).toContain("errored ERR_PROXY_TUNNEL");

  const events = JSON.parse(readFileSync(traceFile, "utf8")).traceEvents;
  const phases = events.filter(e => e.name === "http.client.request").map(e => e.ph);
  expect({ phases: phases.sort(), exitCode }).toEqual({ phases: ["b", "e"], exitCode: 0 });
});

// What Node v26.12.1 writes for a timer under "node.async_hooks": 'b' <type> when it is made, 'B' and 'E' <type>_CALLBACK
// around each run of its callback, and 'e' <type> when it is destroyed. All four carry the async id of the timer.
describe.concurrent("node.async_hooks events of timers", () => {
  type TimerEvent = {
    ph: string;
    name: string;
    id: string;
    tid: number;
    args: { data?: { triggerAsyncId: number; executionAsyncId: number } };
  };
  const kCategory = ["--trace-event-categories", "node.async_hooks"];
  const kOneRun = ["b Timeout", "B Timeout_CALLBACK", "E Timeout_CALLBACK", "e Timeout"];
  const kNoRun = ["b Timeout", "e Timeout"];

  /** Runs `script` and gives back what it printed and the "node,node.async_hooks" events of its trace file, if it wrote one. */
  async function run(script: string, flags: string[] = kCategory) {
    using dir = tempDir("trace-events-timers", { "main.cjs": script });
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...flags, "main.cjs"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const traceFile = join(String(dir), "node_trace.1.log");
    const traced = existsSync(traceFile) ? JSON.parse(readFileSync(traceFile, "utf8")).traceEvents : [];
    const events: TimerEvent[] = traced.filter(event => event.cat === "node,node.async_hooks");
    return { stdout, events };
  }

  /** The events of each timer, one timer after the other in the order in which they were made. */
  function lives(events: TimerEvent[]) {
    const byTimer = new Map<string, string[]>();
    for (const { tid, id, ph, name } of events) {
      const key = `${tid}:${id}`;
      if (!byTimer.has(key)) byTimer.set(key, []);
      byTimer.get(key)!.push(`${ph} ${name}`);
    }
    return [...byTimer.values()];
  }

  test.each([
    ["createTracing().enable()", []],
    ["--trace-event-categories node.async_hooks", kCategory],
  ])("a span around each run of a callback, with %s", async (_, flags) => {
    const { events } = await run(
      `
        if (process.execArgv.length === 0) {
          require("node:trace_events").createTracing({ categories: ["node.async_hooks"] }).enable();
        }
        setTimeout(() => {}, 1);
        const interval = setInterval(() => clearInterval(interval), 1);
        clearTimeout(setTimeout(() => {}, 60_000));
      `,
      flags,
    );
    expect(lives(events)).toEqual([kOneRun, kOneRun, kNoRun]);
    expect(events.filter(event => event.id === events[0].id).map(({ ph, name, args }) => ({ ph, name, args }))).toEqual(
      [
        { ph: "b", name: "Timeout", args: { data: { triggerAsyncId: 1, executionAsyncId: 1 } } },
        { ph: "B", name: "Timeout_CALLBACK", args: {} },
        { ph: "E", name: "Timeout_CALLBACK", args: {} },
        { ph: "e", name: "Timeout", args: {} },
      ],
    );
  });

  test("a timer ends after the last run of its callback", async () => {
    const { events } = await run(`
      process.on("uncaughtException", () => {});
      let ticks = 0;
      const interval = setInterval(() => { if (++ticks === 3) clearInterval(interval); }, 1);
      let runs = 0;
      const refreshed = setTimeout(() => { if (++runs === 1) refreshed.refresh(); }, 1);
      setTimeout(() => { throw new Error("the span of this callback ends too"); }, 1);
    `);
    const span = ["B Timeout_CALLBACK", "E Timeout_CALLBACK"];
    expect(lives(events)).toEqual([
      ["b Timeout", ...span, ...span, ...span, "e Timeout"],
      ["b Timeout", ...span, ...span, "e Timeout"],
      kOneRun,
    ]);
  });

  test("every way to clear a timer ends it once", async () => {
    const { events } = await run(`
      const never = () => { throw new Error("cleared"); };
      setTimeout(never, 60_000).close();
      setTimeout(never, 60_000)[Symbol.dispose]();
      clearTimeout(+setTimeout(never, 60_000));
      clearTimeout(String(+setInterval(never, 60_000)));
      clearInterval(setTimeout(never, 60_000));
      const twice = setTimeout(never, 60_000);
      clearTimeout(twice);
      clearTimeout(twice);
      setTimeout(never, 1)._onTimeout = null;
    `);
    expect(lives(events)).toEqual([kNoRun, kNoRun, kNoRun, kNoRun, kNoRun, kNoRun, kNoRun]);
  });

  test("immediates", async () => {
    const { events } = await run(`
      setImmediate(() => {});
      clearImmediate(setImmediate(() => { throw new Error("cleared"); }));
      const immediate = setImmediate(() => clearImmediate(immediate));
    `);
    const oneRun = ["b Immediate", "B Immediate_CALLBACK", "E Immediate_CALLBACK", "e Immediate"];
    expect(lives(events)).toEqual([oneRun, ["b Immediate", "e Immediate"], oneRun]);
  });

  test("a timer that script clears ends when that script has returned", async () => {
    const { events } = await run(`
      clearTimeout(setTimeout(() => {}, 60_000));
      clearTimeout(setTimeout(() => {}, 60_000));
      const pending = setTimeout(() => {}, 60_000);
      setTimeout(() => clearTimeout(pending), 1);
    `);
    const names = new Map(events.filter(event => event.ph === "b").map((event, i) => [event.id, "ABCD"[i]]));
    expect(events.map(({ ph, name, id }) => `${ph} ${name} ${names.get(id)}`)).toEqual([
      "b Timeout A",
      "b Timeout B",
      "b Timeout C",
      "b Timeout D",
      "e Timeout A",
      "e Timeout B",
      "B Timeout_CALLBACK D",
      "E Timeout_CALLBACK D",
      "e Timeout C",
      "e Timeout D",
    ]);
  });

  test("a timer made in a callback names the timer of that callback", async () => {
    const { events } = await run(`
      setTimeout(() => {
        setTimeout(() => {}, 1);
        setImmediate(() => {});
      }, 1);
    `);
    const made = events.filter(event => event.ph === "b");
    const outer = parseInt(made[0].id, 16);
    expect(made.map(({ name, args }) => ({ name, ...args.data }))).toEqual([
      { name: "Timeout", triggerAsyncId: 1, executionAsyncId: 1 },
      { name: "Timeout", triggerAsyncId: outer, executionAsyncId: outer },
      { name: "Immediate", triggerAsyncId: outer, executionAsyncId: outer },
    ]);
    expect(outer).toBeGreaterThan(1);
  });

  test("timers of functions that were taken before the category was enabled", async () => {
    const { events } = await run(
      `
        const saved = setTimeout;
        const timers = require("node:timers");
        const { setTimeout: sleep } = require("node:timers/promises");
        setTimeout(() => {}, 1); // Made before the category is on: it has no events.
        require("node:trace_events").createTracing({ categories: ["node.async_hooks"] }).enable();
        saved(() => {}, 1);
        timers.setTimeout(() => {}, 1);
        sleep(1);
      `,
      [],
    );
    expect(lives(events)).toEqual([kOneRun, kOneRun, kOneRun]);
  });

  test("a timer that outlives the category has no more events", async () => {
    const { events } = await run(
      `
        const tracing = require("node:trace_events").createTracing({ categories: ["node.async_hooks"] });
        tracing.enable();
        setTimeout(() => {}, 1);
        clearTimeout(setTimeout(() => {}, 60_000));
        tracing.disable();
        setTimeout(() => {}, 1);
        tracing.enable();
      `,
      [],
    );
    expect(lives(events)).toEqual([["b Timeout"], ["b Timeout"]]);
  });

  test("tracing leaves the timer functions and the callback as they are", async () => {
    const { stdout } = await run(
      `
        const names = ["setTimeout", "setInterval", "setImmediate", "clearTimeout", "clearInterval", "clearImmediate"];
        const before = names.map(name => globalThis[name]);
        const replaced = () => names.filter((name, i) => globalThis[name] !== before[i] || require("node:timers")[name] !== before[i]);
        require("node:trace_events").createTracing({ categories: ["node.perf"] }).enable();
        const withAnotherCategory = replaced();
        require("node:trace_events").createTracing({ categories: ["node.async_hooks"] }).enable();
        const callback = () => {};
        const timeout = setTimeout(callback, 1);
        console.log(JSON.stringify({
          replaced: [...withAnotherCategory, ...replaced()],
          callback: timeout._onTimeout === callback,
          symbols: Object.getOwnPropertySymbols(timeout).length,
        }));
      `,
      [],
    );
    expect(JSON.parse(stdout)).toEqual({ replaced: [], callback: true, symbols: 0 });
  });

  test("a worker", async () => {
    const { events } = await run(`
      const { Worker } = require("node:worker_threads");
      new Worker("setTimeout(() => {}, 1)", { eval: true });
      setTimeout(() => {}, 1);
    `);
    expect(lives(events)).toEqual([kOneRun, kOneRun]);
    expect(new Set(events.map(event => event.tid)).size).toBe(2);
  });

  test("the NodeTracing domain of node:inspector", async () => {
    const { stdout } = await run(
      `
        const session = new (require("node:inspector").Session)();
        session.connect();
        const collected = [];
        session.on("NodeTracing.dataCollected", ({ params }) => collected.push(...params.value));
        session.post("NodeTracing.start", { traceConfig: { includedCategories: ["node.async_hooks"] } }, () => {
          setTimeout(() => {
            setImmediate(() => {
              session.post("NodeTracing.stop", () => {
                const timers = collected.filter(event => event.cat === "node,node.async_hooks");
                console.log(JSON.stringify(timers.map(event => event.ph + " " + event.name)));
              });
            });
          }, 1);
        });
      `,
      [],
    );
    expect(JSON.parse(stdout)).toEqual([
      "b Timeout",
      "B Timeout_CALLBACK",
      "b Immediate",
      "E Timeout_CALLBACK",
      "e Timeout",
      "B Immediate_CALLBACK",
    ]);
  });
});
