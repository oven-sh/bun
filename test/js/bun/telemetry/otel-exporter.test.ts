import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { mkfifo } from "mkfifo";
import { open } from "node:fs/promises";
import { basename, join } from "node:path";
import { gunzipSync } from "node:zlib";

const root = require("@opentelemetry/otlp-transformer/build/src/generated/root");
const Req = root.opentelemetry.proto.collector.trace.v1.ExportTraceServiceRequest;

type Received = { headers: Record<string, string>; body: any; raw: Uint8Array; url: string };

/** A minimal OTLP/HTTP collector. `respond` lets a test inject failures. */
function collector(respond?: (n: number) => Response | undefined) {
  const received: Received[] = [];
  let n = 0;
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      // GET /count: how many export requests arrived so far (for polling from fixtures)
      if (req.method === "GET") return Response.json(received.length);
      const i = n++;
      const override = respond?.(i);
      let raw = new Uint8Array(await req.arrayBuffer());
      if (req.headers.get("content-encoding") === "gzip") raw = new Uint8Array(gunzipSync(raw));
      let body: any;
      const ct = req.headers.get("content-type") ?? "";
      if (ct.includes("json")) body = JSON.parse(new TextDecoder().decode(raw));
      else body = Req.toObject(Req.decode(raw), { longs: String, defaults: false });
      received.push({ headers: Object.fromEntries(req.headers), body, raw, url: req.url });
      if (override) return override;
      return new Response(new Uint8Array([]), { headers: { "content-type": "application/x-protobuf" } });
    },
  });
  return {
    server,
    received,
    url: `http://localhost:${server.port}`,
    spans(): any[] {
      return received.flatMap(
        r => r.body.resourceSpans?.flatMap((rs: any) => rs.scopeSpans.flatMap((ss: any) => ss.spans)) ?? [],
      );
    },
    [Symbol.dispose]() {
      server.stop(true);
    },
  };
}

// The runner's own environment must not configure the child (OTEL_* /
// BUN_OTEL* would change endpoints, samplers, service names).
const cleanEnv: Record<string, string> = Object.fromEntries(
  Object.entries(bunEnv).filter(([k]) => !/^(OTEL_|BUN_OTEL|HTTPS?_PROXY$|NO_PROXY$|https?_proxy$|no_proxy$)/.test(k)),
) as Record<string, string>;

const withoutLeakCheck = [bunEnv.ASAN_OPTIONS, "detect_leaks=0"].filter(Boolean).join(":");

async function run(script: string, env: Record<string, string>) {
  using dir = tempDir("otel-exporter", { "index.js": script });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    cwd: String(dir),
    env: { ...cleanEnv, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

describe.concurrent("OTLP/HTTP exporter", () => {
  test("BUN_OTEL=1 + OTEL_EXPORTER_OTLP_ENDPOINT: spans are exported at exit with headers and resource", async () => {
    using c = collector();
    const { stderr, exitCode } = await run(
      `
        const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
        await (await fetch("http://localhost:" + server.port + "/x")).text();
        server.stop(true);
      `,
      {
        BUN_OTEL: "1",
        OTEL_EXPORTER_OTLP_ENDPOINT: c.url,
        OTEL_EXPORTER_OTLP_HEADERS: "x-api-key=secret%20key,x-other=1",
        OTEL_SERVICE_NAME: "env-svc",
        OTEL_RESOURCE_ATTRIBUTES: "deployment.environment=ci,team=runtime",
      },
    );
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(c.received.length).toBeGreaterThanOrEqual(1);
    const r = c.received[0];
    expect(new URL(r.url).pathname).toBe("/v1/traces");
    expect(r.headers["content-type"]).toBe("application/x-protobuf");
    expect(r.headers["x-api-key"]).toBe("secret key");
    expect(r.headers["x-other"]).toBe("1");
    expect(r.headers["user-agent"]).toMatch(/^Bun\//);
    const attrs = Object.fromEntries(
      r.body.resourceSpans[0].resource.attributes.map((a: any) => [a.key, Object.values(a.value)[0]]),
    );
    expect(attrs).toMatchObject({
      "service.name": "env-svc",
      "deployment.environment": "ci",
      team: "runtime",
      "telemetry.sdk.name": "bun",
      "process.runtime.name": "bun",
      // the running binary's name (bun, bun-debug, or a --compile output's own name)
      "process.executable.name": basename(bunExe()),
      "process.executable.path": expect.any(String),
      "process.command": expect.stringMatching(/index\.js$/),
      "host.name": require("node:os").hostname(),
      "host.arch": expect.stringMatching(/^(amd64|arm64)$/),
      "os.type": expect.stringMatching(/^(linux|darwin|windows|freebsd)$/),
      "os.version": expect.any(String),
    });
    const names = c
      .spans()
      .map((s: any) => s.name)
      .sort();
    expect(names).toEqual(["GET", "GET"]);
    const scopes = r.body.resourceSpans[0].scopeSpans.map((s: any) => s.scope.name).sort();
    expect(scopes).toEqual(["bun.http.client", "bun.http.server"]);
  });

  test("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT is used verbatim; gzip compression", async () => {
    using c = collector();
    const { stderr, exitCode } = await run(`Bun.otel.tracer("t").startSpan("s").end();`, {
      BUN_OTEL: "1",
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: c.url + "/custom/path",
      OTEL_EXPORTER_OTLP_COMPRESSION: "gzip",
    });
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(c.received).toHaveLength(1);
    expect(new URL(c.received[0].url).pathname).toBe("/custom/path");
    expect(c.received[0].headers["content-encoding"]).toBe("gzip");
    expect(c.spans().map((s: any) => s.name)).toEqual(["s"]);
  });

  test("process.exit() with a JS-exporter export queued does not wait out the export timeout", async () => {
    // A full batch schedules an async export task; exiting before it runs
    // must not block in shutdown for OTEL_BSP_EXPORT_TIMEOUT.
    const started = Date.now();
    const { stdout, exitCode } = await run(
      `
        let n = 0;
        Bun.otel.start({ exporters: [{ export(spans) { n += spans.length; } }], batch: { maxExportBatchSize: 8 } });
        const t = Bun.otel.tracer("t");
        for (let i = 0; i < 8; i++) t.startSpan("s" + i).end();
        console.log("exiting");
        process.exit(0);
      `,
      { OTEL_BSP_EXPORT_TIMEOUT: "60000" },
    );
    expect(stdout.trim()).toBe("exiting");
    // only needs to tell "returned promptly" from "waited out the 60 s export timeout"
    expect(Date.now() - started).toBeLessThan(30000);
    expect(exitCode).toBe(0);
  });

  test("a worker's function exporter is removed when the worker exits (no failed exports afterwards)", async () => {
    using dir = tempDir("otel-worker-exporter", {
      "worker.js": `
        Bun.otel.start({ exporters: [{ export() {} }] });
        Bun.otel.tracer("w").startSpan("in-worker").end();
        await Bun.otel.forceFlush();
        postMessage("done");
      `,
      "index.js": `
        Bun.otel.start({ exporters: [{ export() {} }] });
        const w = new Worker("./worker.js");
        await new Promise(r => (w.onmessage = r));
        await w.terminate();
        Bun.otel.tracer("m").startSpan("after-worker").end();
        await Bun.otel.forceFlush();
        const { exportsFailed, spansDropped } = Bun.otel.stats();
        console.log(JSON.stringify({ exportsFailed, spansDropped }));
      `,
    });
    await using proc = Bun.spawn({ cmd: [bunExe(), "index.js"], cwd: String(dir), env: bunEnv, stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout.trim()).toBe(JSON.stringify({ exportsFailed: 0, spansDropped: 0 }));
    expect(exitCode).toBe(0);
  });

  test("bun test --isolate: every file's global gets the api bridge and all spans export at exit", async () => {
    using c = collector();
    const file = (name: string) => `
      import { test, expect } from "bun:test";
      test("${name}", () => {
        expect(globalThis[Symbol.for("opentelemetry.js.api.1")]?.trace).toBeDefined();
        Bun.otel.tracer("t").startSpan("${name}").end();
      });
    `;
    using dir = tempDir("otel-isolate", { "a.test.js": file("a"), "b.test.js": file("b") });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--isolate", "./a.test.js", "./b.test.js"],
      cwd: String(dir),
      env: { ...bunEnv, BUN_OTEL: "1", OTEL_EXPORTER_OTLP_ENDPOINT: c.url },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("2 pass");
    expect(exitCode).toBe(0);
    expect(
      c
        .spans()
        .map((s: any) => s.name)
        .sort(),
    ).toEqual(["a", "b"]);
  });

  test("not enabled without BUN_OTEL even if OTEL_* vars are present", async () => {
    using c = collector();
    const { stdout, exitCode } = await run(
      `Bun.otel.tracer("t").startSpan("s").end(); console.log(Bun.otel.enabled);`,
      {
        OTEL_EXPORTER_OTLP_ENDPOINT: c.url,
      },
    );
    expect(stdout.trim()).toBe("false");
    expect(exitCode).toBe(0);
    expect(c.received).toHaveLength(0);
  });

  test("Bun.otel.start() with no options picks up OTEL_* env", async () => {
    using c = collector();
    const { exitCode } = await run(`Bun.otel.start(); Bun.otel.tracer("t").startSpan("s").end();`, {
      OTEL_EXPORTER_OTLP_ENDPOINT: c.url,
    });
    expect(exitCode).toBe(0);
    expect(c.spans().map((s: any) => s.name)).toEqual(["s"]);
  });

  test("Bun.otel.start() reads OTEL_* from process.env as it is at the call, not only the startup environment", async () => {
    using c = collector();
    const { exitCode, stderr } = await run(
      `process.env.OTEL_EXPORTER_OTLP_ENDPOINT = process.env.LATE_ENDPOINT;
       process.env.OTEL_SERVICE_NAME = "set-late";
       delete process.env.OTEL_TRACES_SAMPLER; // was "always_off" at startup
       // a replaced process.env object counts too (test runners reset it that way)
       process.env = { ...process.env, OTEL_RESOURCE_ATTRIBUTES: "team=core" };
       Bun.otel.start();
       Bun.otel.tracer("t").startSpan("s").end();`,
      { LATE_ENDPOINT: c.url, OTEL_TRACES_SAMPLER: "always_off" },
    );
    expect(stderr).toBe("");
    expect(c.spans().map((s: any) => s.name)).toEqual(["s"]);
    const attrs = Object.fromEntries(
      c.received[0].body.resourceSpans[0].resource.attributes.map((a: any) => [a.key, a.value.stringValue]),
    );
    expect([attrs["service.name"], attrs["team"]]).toEqual(["set-late", "core"]);
    expect(exitCode).toBe(0);
  });

  test("OTLP exports go through HTTP_PROXY and honour NO_PROXY, as fetch() does", async () => {
    using proxy = collector(); // a plain-http endpoint is proxied in absolute form, so a collector can play the proxy
    using direct = collector();
    let r = await run(`Bun.otel.start(); Bun.otel.tracer("t").startSpan("via-proxy").end();`, {
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://collector.invalid:4318",
      HTTP_PROXY: proxy.url,
    });
    expect(r.stderr).toBe("");
    expect(proxy.spans().map((s: any) => s.name)).toEqual(["via-proxy"]);
    expect(new URL(proxy.received[0].url).pathname).toBe("/v1/traces");
    r = await run(`Bun.otel.start(); Bun.otel.tracer("t").startSpan("direct").end();`, {
      OTEL_EXPORTER_OTLP_ENDPOINT: direct.url,
      HTTP_PROXY: proxy.url,
      NO_PROXY: "localhost",
    });
    expect(r.stderr).toBe("");
    expect(direct.spans().map((s: any) => s.name)).toEqual(["direct"]);
    expect(proxy.received).toHaveLength(1);
    expect(r.exitCode).toBe(0);
  });

  test("client-certificate OTEL_EXPORTER_OTLP_* variables are reported as not supported yet", async () => {
    using c = collector();
    const { stderr, exitCode } = await run(`Bun.otel.start(); Bun.otel.tracer("t").startSpan("s").end();`, {
      OTEL_EXPORTER_OTLP_ENDPOINT: c.url,
      OTEL_EXPORTER_OTLP_CLIENT_KEY: "/nope.pem",
    });
    expect(stderr).toContain("OTEL_EXPORTER_OTLP_CLIENT_KEY is not supported yet");
    expect(c.spans().map((s: any) => s.name)).toEqual(["s"]);
    expect(exitCode).toBe(0);
  });

  test("OTEL_SDK_DISABLED wins", async () => {
    using c = collector();
    const { stdout, exitCode } = await run(`console.log(Bun.otel.enabled)`, {
      BUN_OTEL: "1",
      OTEL_SDK_DISABLED: "true",
      OTEL_EXPORTER_OTLP_ENDPOINT: c.url,
    });
    expect(stdout.trim()).toBe("false");
    expect(exitCode).toBe(0);
    expect(c.received).toHaveLength(0);
  });

  test("periodic export while the process stays alive (OTEL_BSP_SCHEDULE_DELAY)", async () => {
    using c = collector();
    const script = `
      Bun.otel.tracer("t").startSpan("early").end();
      // Stay alive without calling forceFlush; the batch timer must fire on its own.
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const r = await fetch(process.env.COLLECTOR + "/count");
        if ((await r.text()) !== "0") break;
        await Bun.sleep(20);
      }
      console.log("exported-before-exit");
    `;
    // The collector answers /count with how many exports it has seen so far.
    let count = 0;
    using probe = Bun.serve({
      port: 0,
      async fetch(req) {
        if (new URL(req.url).pathname === "/count") return new Response(String(count));
        count++;
        return c.server.fetch(req);
      },
    });
    const { stdout, exitCode } = await run(script, {
      BUN_OTEL: "1",
      BUN_OTEL_INSTRUMENTATIONS: "user",
      OTEL_EXPORTER_OTLP_ENDPOINT: `http://localhost:${probe.port}`,
      COLLECTOR: `http://localhost:${probe.port}`,
      OTEL_BSP_SCHEDULE_DELAY: "50",
    });
    expect(stdout.trim()).toBe("exported-before-exit");
    expect(exitCode).toBe(0);
    expect(c.spans().map((s: any) => s.name)).toContain("early");
  });

  test("retries 503 then succeeds; forceFlush waits for the retry", async () => {
    using c = collector(i => (i === 0 ? new Response("busy", { status: 503 }) : undefined));
    const { stdout, exitCode } = await run(
      `
        Bun.otel.start({ endpoint: process.env.COLLECTOR, batch: { delayMs: 20 } });
        Bun.otel.tracer("t").startSpan("retried").end();
        // First attempt gets a 503 and is parked; forceFlush retries it now and waits.
        await Bun.otel.forceFlush();
        console.log(JSON.stringify(Bun.otel.stats()));
      `,
      { COLLECTOR: c.url },
    );
    expect(exitCode).toBe(0);
    const stats = JSON.parse(stdout.trim());
    expect(stats.spansExported).toBe(1);
    expect(stats.exportsFailed).toBe(0);
    expect(c.received.length).toBe(2);
    expect(c.spans().map((s: any) => s.name)).toEqual(["retried", "retried"]);
  });

  test("a partial_success response is reported with the collector's message", async () => {
    // ExportTraceServiceResponse { partial_success { rejected_spans: 1, error_message: "bad span" } }
    const msg = new TextEncoder().encode("bad span");
    const ps = new Uint8Array([0x08, 0x01, 0x12, msg.length, ...msg]);
    const body = new Uint8Array([0x0a, ps.length, ...ps]);
    using c = collector(() => new Response(body, { headers: { "content-type": "application/x-protobuf" } }));
    const { stderr, exitCode } = await run(
      `
        Bun.otel.start({ endpoint: process.env.COLLECTOR });
        Bun.otel.tracer("t").startSpan("x").end();
        await Bun.otel.forceFlush();
      `,
      { COLLECTOR: c.url },
    );
    expect(stderr).toContain("collector rejected 1 span(s): bad span");
    expect(exitCode).toBe(0);
  });

  test("Retry-After on a 429 sets the retry delay", async () => {
    // A 429 with Retry-After: 60 parks the batch for 60 s (not the default 1 s),
    // so 1.5 s later it has not been retried. forceFlush() leaves it parked, and the exit gives it a last try.
    using c = collector(i =>
      i === 0 ? new Response("slow down", { status: 429, headers: { "Retry-After": "60" } }) : undefined,
    );
    const { stdout, exitCode } = await run(
      `
        Bun.otel.start({ endpoint: process.env.COLLECTOR, batch: { delayMs: 10 } });
        Bun.otel.tracer("t").startSpan("x").end();
        const count = async () => (await fetch(process.env.COLLECTOR)).json();
        for (let i = 0; i < 300 && (await count()) < 1; i++) await Bun.sleep(10);
        await Bun.sleep(1500);
        const before = await count();
        await Bun.otel.forceFlush();
        console.log(JSON.stringify([before, await count(), Bun.otel.stats().spansExported]));
      `,
      { COLLECTOR: c.url, BUN_OTEL_INSTRUMENTATIONS: "http" },
    );
    expect(stdout.trim()).toBe(JSON.stringify([1, 1, 0]));
    expect(c.received.length).toBe(2);
    expect(exitCode).toBe(0);
  });

  test("forceFlush() neither overrides Retry-After nor waits for it, and waits for the other exporters", async () => {
    using c = collector(() => new Response(null, { status: 429, headers: { "retry-after": "100" } }));
    const { stdout, exitCode } = await run(
      `let slow = "pending";
       const asked = async () => (await fetch(process.env.URL)).json();
       Bun.otel.start({
         instrumentations: [],
         exporters: [process.env.URL, { async export() { while (!(await asked())) await Bun.sleep(5); await asked(); slow = "done"; } }],
       });
       Bun.otel.span("s", () => {});
       await Bun.otel.forceFlush();
       await Bun.otel.forceFlush();
       console.log(slow, await asked());`,
      { URL: c.url },
    );
    expect({ stdout, exitCode }).toEqual({ stdout: "done 1\n", exitCode: 0 });
  });

  test("after a forceFlush(), later failed exports keep their backoff, and the exit makes one more attempt", async () => {
    const arrivals: number[] = [];
    using c = collector(i => {
      if (i === 0) return;
      arrivals.push(performance.now());
      return new Response("busy", { status: 503 });
    });
    const { exitCode } = await run(
      `
        Bun.otel.start({ endpoint: process.env.COLLECTOR, batch: { delayMs: 10 }, instrumentations: [] });
        Bun.otel.tracer("t").startSpan("first").end();
        await Bun.otel.forceFlush();
        Bun.otel.tracer("t").startSpan("second").end();
        while ((await (await fetch(process.env.COLLECTOR + "/count")).json()) < 3) await Bun.sleep(5);
        while (Bun.otel.stats().exportsInflight) await Bun.sleep(1);
        process.exit(0);
      `,
      { COLLECTOR: c.url },
    );
    const gaps = arrivals.slice(1).map((at, i) => at - arrivals[i]);
    expect(gaps[0]).toBeGreaterThan(900);
    expect(gaps.length).toBeGreaterThanOrEqual(2);
    expect(gaps.filter(gap => gap < 900).length).toBeLessThanOrEqual(1);
    expect(exitCode).toBe(0);
  });

  test("unreachable collector: retried export does not stall process exit", async () => {
    // A collector that drops every connection: the export fails (retryable)
    // and is parked; exit must not wait out OTEL_BSP_EXPORT_TIMEOUT for it.
    // (Held open so no concurrent test can be handed this port.)
    using dead = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open(s) {
          s.end();
        },
        data() {},
      },
    });
    const port = dead.port;
    const { exitCode, stderr } = await run(
      `
        const t = Bun.otel.tracer("t");
        t.startSpan("a").end();
        await Bun.otel.forceFlush().catch(() => {});
        t.startSpan("b").end();
      `,
      {
        BUN_OTEL: "1",
        OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:" + port,
        OTEL_BSP_EXPORT_TIMEOUT: "600000",
      },
    );
    expect(exitCode).toBe(0);
  });

  test("exit-time export is bounded by OTEL_BSP_EXPORT_TIMEOUT even when the per-request timeout is longer", async () => {
    // A collector that accepts but never answers. The request timeout is 20s;
    // the export deadline (1s, rounded up to the socket timer's granularity)
    // is what bounds process exit.
    const socks: any[] = [];
    using hang = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        open(s) {
          socks.push(s);
        },
        data() {},
      },
    });
    const started = performance.now();
    const { exitCode } = await run(`Bun.otel.tracer("t").startSpan("a").end();`, {
      BUN_OTEL: "1",
      OTEL_EXPORTER_OTLP_ENDPOINT: "http://127.0.0.1:" + hang.port,
      OTEL_EXPORTER_OTLP_TIMEOUT: "20000",
      OTEL_BSP_EXPORT_TIMEOUT: "1000",
    });
    expect(performance.now() - started).toBeLessThan(15_000);
    expect(exitCode).toBe(0);
  }, 30_000);

  test("a start() that throws (bad URL) leaves the previously configured exporters in place", async () => {
    using c = collector();
    const script = `
      Bun.otel.start({ exporters: [process.env.C] });
      let threw = false;
      try { Bun.otel.start({ exporters: [{ url: "not a url" }] }); } catch { threw = true; }
      Bun.otel.tracer("t").startSpan("still-exported").end();
      await Bun.otel.forceFlush();
      console.log(threw);
    `;
    const { stdout, exitCode } = await run(script, { C: c.url });
    expect(stdout.trim()).toBe("true");
    expect(c.spans().map((s: any) => s.name)).toEqual(["still-exported"]);
    expect(exitCode).toBe(0);
  });

  test("Bun.otel.start() reports malformed OTEL_* env once, like BUN_OTEL=1 does", async () => {
    using c = collector();
    const { stderr, exitCode } = await run(
      `Bun.otel.start({ endpoint: process.env.C }); Bun.otel.start({ endpoint: process.env.C });`,
      { C: c.url, OTEL_TRACES_SAMPLER: "traceidratio", OTEL_TRACES_SAMPLER_ARG: "lots" },
    );
    expect(stderr.match(/OTEL_TRACES_SAMPLER_ARG/g)?.length).toBe(1);
    expect(exitCode).toBe(0);
  });

  test("a function exporter that records spans while the process is exiting does not leave a timer behind", async () => {
    const { stdout, exitCode } = await run(
      `
        Bun.otel.start({
          exporters: [{ export(spans) { console.log("export", spans.length); Bun.otel.tracer("x").startSpan("from-exporter").end(); } }],
        });
        Bun.otel.tracer("t").startSpan("s").end();
      `,
      {},
    );
    // The exit-time flush delivers "s"; the span ended inside the exporter must
    // not re-arm a timer that outlives the VM (a use-after-free under ASAN).
    expect(stdout).toContain("export 1");
    expect(exitCode).toBe(0);
  });

  test("console exporter with many one-span batches chains without recursing", async () => {
    const { stderr, exitCode } = await run(
      `
        const t = Bun.otel.tracer("t");
        for (let i = 0; i < 300; i++) t.startSpan("s" + i).end();
        await Bun.otel.forceFlush();
      `,
      { BUN_OTEL: "1", OTEL_TRACES_EXPORTER: "console", OTEL_BSP_MAX_EXPORT_BATCH_SIZE: "1" },
    );
    // every span reaches stderr (payloads may carry more than one span)
    expect(stderr.match(/"spanId"/g)?.length).toBe(300);
    expect(stderr.match(/"resourceSpans"/g)!.length).toBeGreaterThan(1);
    expect(exitCode).toBe(0);
  });

  test("start() without exporters keeps the env-configured pipeline instead of duplicating it", async () => {
    using c = collector();
    const { exitCode, stderr } = await run(
      `
        Bun.otel.start({ serviceName: "renamed" }); // options only, no exporters
        Bun.otel.tracer("t").startSpan("once").end();
        await Bun.otel.forceFlush();
      `,
      { BUN_OTEL: "1", OTEL_EXPORTER_OTLP_ENDPOINT: c.url },
    );
    expect(stderr).toBe("");
    expect(c.spans().map((s: any) => s.name)).toEqual(["once"]);
    expect(c.received.length).toBe(1);
    expect(exitCode).toBe(0);
  });

  test("non-retryable failure is reported once on stderr and counted", async () => {
    using c = collector(() => new Response("nope", { status: 400 }));
    const { stdout, stderr, exitCode } = await run(
      `
        Bun.otel.start({ endpoint: process.env.COLLECTOR });
        Bun.otel.tracer("t").startSpan("a").end();
        await Bun.otel.forceFlush();
        Bun.otel.tracer("t").startSpan("b").end();
        await Bun.otel.forceFlush();
        console.log(JSON.stringify(Bun.otel.stats()));
      `,
      { COLLECTOR: c.url },
    );
    expect(exitCode).toBe(0);
    expect(stderr.match(/\[otel\]/g)?.length).toBe(1);
    expect(stderr).toContain("HTTP 400");
    const stats = JSON.parse(stdout.trim());
    expect(stats.exportsFailed).toBe(2);
    expect(stats.spansDropped).toBe(2);
  });

  test("multiple exporters receive the same batch", async () => {
    using a = collector();
    using b = collector();
    const { stdout, stderr, exitCode } = await run(
      `
        let js = 0;
        Bun.otel.start({ exporters: [process.env.A, { url: process.env.B, headers: { "x-b": "yes" } }, { export(spans) { js += spans.length; } }, "console"] });
        Bun.otel.tracer("t").startSpan("multi").end();
        await Bun.otel.forceFlush();
        console.log(js);
      `,
      { A: a.url, B: b.url },
    );
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBe("1");
    expect(a.spans().map((s: any) => s.name)).toEqual(["multi"]);
    expect(b.spans().map((s: any) => s.name)).toEqual(["multi"]);
    expect(b.received[0].headers["x-b"]).toBe("yes");
    expect(stderr).toContain('"name":"multi"');
  });

  test("OTEL_TRACES_EXPORTER=console prints one OTLP/JSON document per batch to stderr", async () => {
    const { stderr, exitCode } = await run(
      `Bun.otel.tracer("t").startSpan("printed", { attributes: { k: "v" } }).end();`,
      {
        BUN_OTEL: "1",
        OTEL_TRACES_EXPORTER: "console",
      },
    );
    const line = stderr.split("\n").find(l => l.startsWith('{"resourceSpans"'));
    expect(line).toBeDefined();
    const doc = JSON.parse(line!);
    const span = doc.resourceSpans[0].scopeSpans[0].spans[0];
    expect(doc.resourceSpans[0].scopeSpans[0].scope.name).toBe("t");
    expect(span.name).toBe("printed");
    expect(span.attributes).toEqual([{ key: "k", value: { stringValue: "v" } }]);
    expect(exitCode).toBe(0);
  });

  test("console listed twice installs one console exporter", async () => {
    const script = (start: string) => `
      ${start}
      Bun.otel.tracer("t").startSpan("once").end();
      await Bun.otel.forceFlush();
    `;
    const [env, api] = await Promise.all([
      run(script(""), { BUN_OTEL: "1", OTEL_TRACES_EXPORTER: "console, console" }),
      run(script(`Bun.otel.start({ exporters: ["console", "console"] });`), { BUN_OTEL: "1" }),
    ]);
    expect(env.stderr.match(/"name":"once"/g)?.length).toBe(1);
    expect(api.stderr.match(/"name":"once"/g)?.length).toBe(1);
    expect(env.exitCode).toBe(0);
    expect(api.exitCode).toBe(0);
  });

  test("worker spans are exported through the shared processor", async () => {
    using c = collector();
    using dir = tempDir("otel-worker", {
      "worker.js": `
        Bun.otel.tracer("w").startSpan("in-worker").end();
        postMessage("done");
      `,
      "index.js": `
        const w = new Worker("./worker.js");
        await new Promise(r => w.onmessage = r);
        await w.terminate();
        Bun.otel.tracer("m").startSpan("in-main").end();
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      cwd: String(dir),
      env: { ...bunEnv, BUN_OTEL: "1", BUN_OTEL_INSTRUMENTATIONS: "user", OTEL_EXPORTER_OTLP_ENDPOINT: c.url },
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(
      c
        .spans()
        .map((s: any) => s.name)
        .sort(),
    ).toEqual(["in-main", "in-worker"]);
  });

  test("Bun.otel.start() from several workers at once registers the endpoint once", async () => {
    using c = collector();
    using dir = tempDir("otel-workers-start", {
      "worker.js": `
        Bun.otel.start({ endpoint: process.env.C });
        Bun.otel.tracer("w").startSpan("w").end();
        await Bun.otel.forceFlush();
        postMessage("done");
      `,
      "index.js": `
        const workers = Array.from({ length: 4 }, () => new Worker("./worker.js"));
        Bun.otel.start({ endpoint: process.env.C });
        await Promise.all(workers.map(w => new Promise(r => (w.onmessage = r))));
        await Promise.all(workers.map(w => w.terminate()));
        Bun.otel.tracer("m").startSpan("m").end();
        await Bun.otel.forceFlush();
        console.log(JSON.stringify(Bun.otel.stats()));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      cwd: String(dir),
      env: { ...cleanEnv, C: c.url },
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    const stats = JSON.parse(stdout.trim());
    // 5 spans, each exported once: one exporter, however the starts interleaved
    // (a start() that replaces exporters swaps the list atomically, so a
    // concurrent export never finds it empty).
    expect(stats.spansDropped).toBe(0);
    expect(stats.spansExported).toBe(5);
    expect(stats.exportsSucceeded).toBe(c.received.length);
    expect(c.spans().length).toBe(5);
    // every thread has its own id sequence
    expect(new Set(c.spans().map((s: any) => s.traceId)).size).toBe(5);
    expect(new Set(c.spans().map((s: any) => s.spanId)).size).toBe(5);
    expect(exitCode).toBe(0);
  });

  test("start(): an explicit serviceName wins over resourceAttributes['service.name']", async () => {
    using c = collector();
    const { stderr, exitCode } = await run(
      `
        Bun.otel.start({ endpoint: process.env.C, serviceName: "explicit", resourceAttributes: { "service.name": "from-attrs", team: "x" } });
        Bun.otel.tracer("t").startSpan("s").end();
      `,
      { C: c.url },
    );
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    const attrs = Object.fromEntries(
      c.received[0].body.resourceSpans[0].resource.attributes.map((a: any) => [a.key, Object.values(a.value)[0]]),
    );
    expect(attrs["service.name"]).toBe("explicit");
    expect(attrs.team).toBe("x");
  });

  test("an export that outlives OTEL_EXPORTER_OTLP_TIMEOUT (collector trickling its response) is aborted and counted as failed", async () => {
    // first request: headers immediately, then one body byte every 200 ms
    // for ~20 s; the retry is answered normally
    let n = 0;
    using slow = Bun.serve({
      port: 0,
      idleTimeout: 60,
      fetch() {
        if (n++ > 0) return new Response("");
        return new Response(
          new ReadableStream({
            async start(c) {
              for (let i = 0; i < 100; i++) {
                c.enqueue(new Uint8Array([32]));
                await Bun.sleep(200);
              }
              c.close();
            },
          }),
          { headers: { "content-type": "application/x-protobuf" } },
        );
      },
    });
    const { stdout, exitCode } = await run(
      `Bun.otel.start({ exporters: [{ type: "otlp", url: process.env.C, timeoutMs: 1000 }] });
       Bun.otel.tracer("t").startSpan("s").end();
       const t0 = performance.now();
       await Bun.otel.forceFlush();
       const s = Bun.otel.stats();
       console.log(s.spansExported, s.exportsSucceeded, performance.now() - t0 < 8000);`,
      { C: slow.url.href, OTEL_BSP_SCHEDULE_DELAY: "200" },
    );
    // aborted at the timeout, retried, delivered — instead of hanging on the trickle
    expect(stdout.trim()).toBe("1 1 true");
    expect(exitCode).toBe(0);
  });

  test("an async function exporter that never settles is failed after the export timeout instead of stalling the pipeline", async () => {
    const { stdout, exitCode } = await run(
      `let calls = 0;
       Bun.otel.start({ exporters: [{ export() { calls++; return new Promise(() => {}); } }] });
       Bun.otel.tracer("t").startSpan("a").end();
       await Bun.otel.forceFlush();
       Bun.otel.tracer("t").startSpan("b").end();
       await Bun.otel.forceFlush();
       const s = Bun.otel.stats();
       console.log(calls, s.exportsFailed, s.exportsInflight);`,
      { OTEL_BSP_EXPORT_TIMEOUT: "300", OTEL_BSP_SCHEDULE_DELAY: "100" },
    );
    expect(stdout.trim()).toBe("2 2 0");
    expect(exitCode).toBe(0);
  });

  test("OTEL_BSP_MAX_EXPORT_BATCH_SIZE bounds every export request, including under forceFlush", async () => {
    using c = collector();
    const { stdout, exitCode } = await run(
      `Bun.otel.start({ endpoint: process.env.C });
       const t = Bun.otel.tracer("t");
       for (let i = 0; i < 25; i++) t.startSpan("s" + i).end();
       await Bun.otel.forceFlush();
       console.log(Bun.otel.stats().spansExported);`,
      { C: c.url, OTEL_BSP_MAX_EXPORT_BATCH_SIZE: "10" },
    );
    expect(stdout.trim()).toBe("25");
    expect(
      c.received
        .map(r => r.body.resourceSpans[0].scopeSpans.reduce((n: number, s: any) => n + s.spans.length, 0))
        .sort((a: number, b: number) => b - a),
    ).toEqual([10, 10, 5]);
    expect(exitCode).toBe(0);
  });

  test("a payload parked for retry by two failing exporters counts against the queue once, and a healthy exporter keeps receiving", async () => {
    using down1 = collector(() => new Response("no", { status: 503 }));
    using down2 = collector(() => new Response("no", { status: 503 }));
    const { stdout, exitCode } = await run(
      `const seen = [];
       Bun.otel.start({ exporters: [{ type: "otlp", url: process.env.A }, { type: "otlp", url: process.env.B }, { export(b) { seen.push(...b.map(s => s.name)); } }] });
       const t = Bun.otel.tracer("t");
       for (let i = 0; i < 20; i++) t.startSpan("a" + i).end();
       await Bun.otel.forceFlush().catch(() => {});
       // 20 spans parked (once, not twice) against a queue of 48: 20 more still fit
       for (let i = 0; i < 20; i++) t.startSpan("b" + i).end();
       while (seen.length < 40) await Bun.sleep(5);
       const s = Bun.otel.stats();
       console.log(seen.length, s.spansDropped);`,
      { A: down1.url, B: down2.url, OTEL_BSP_MAX_QUEUE_SIZE: "48", OTEL_BSP_SCHEDULE_DELAY: "50" },
    );
    expect(stdout.trim()).toBe("40 0");
    expect(exitCode).toBe(0);
  });

  test("a repeat start() flushes what was recorded under the previous resource first", async () => {
    using c = collector();
    const { exitCode } = await run(
      `Bun.otel.tracer("t").startSpan("early").end();
       Bun.otel.start({ serviceName: "b" });
       Bun.otel.tracer("t").startSpan("late").end();
       await Bun.otel.forceFlush();`,
      { BUN_OTEL: "1", OTEL_SERVICE_NAME: "a", OTEL_EXPORTER_OTLP_ENDPOINT: c.url },
    );
    expect(exitCode).toBe(0);
    // (the two requests race to the collector; pair them by service)
    const bySvc = Object.fromEntries(
      c.received.map(r => [
        r.body.resourceSpans[0].resource.attributes.find((a: any) => a.key === "service.name").value.stringValue,
        r.body.resourceSpans[0].scopeSpans.flatMap((s: any) => s.spans.map((x: any) => x.name)),
      ]),
    );
    expect(bySvc).toEqual({ a: ["early"], b: ["late"] });
  });

  test("OTEL_SDK_DISABLED=true makes Bun.otel.start() a no-op", async () => {
    using c = collector();
    const { stdout, exitCode } = await run(
      `Bun.otel.start({ endpoint: process.env.C }); Bun.otel.tracer("t").startSpan("s").end(); await Bun.otel.forceFlush(); console.log(Bun.otel.enabled);`,
      { C: c.url, OTEL_SDK_DISABLED: "true" },
    );
    expect(stdout.trim()).toBe("false");
    expect(c.received.length).toBe(0);
    expect(exitCode).toBe(0);
  });

  test("OTEL_TRACES_EXPORTER=none: start() without exporters adds no default endpoint", async () => {
    using c = collector(); // listening on the would-be default is not possible (4318), so assert via stats
    const { stdout, exitCode } = await run(
      `Bun.otel.start({ serviceName: "x" }); Bun.otel.tracer("t").startSpan("s").end(); await Bun.otel.forceFlush(); const s = Bun.otel.stats(); console.log(s.exportsFailed, s.exportsSucceeded);`,
      { OTEL_TRACES_EXPORTER: "none" },
    );
    expect(stdout.trim()).toBe("0 0");
    expect(exitCode).toBe(0);
  });

  test("an async function exporter is awaited: forceFlush waits for it and a rejection counts as a failed export, not an unhandled rejection", async () => {
    const { stdout, exitCode } = await run(
      `
      const called = Promise.withResolvers(), release = Promise.withResolvers();
      const exported = [];
      Bun.otel.start({ exporters: [{ async export(spans) { called.resolve(); await release.promise; exported.push(...spans.map(s => s.name)); } }, { async export() { await 1; throw new Error("flaky"); } }] });
      process.on("unhandledRejection", () => { console.log("UNHANDLED"); });
      Bun.otel.tracer("t").startSpan("a").end();
      const flushed = Bun.otel.forceFlush().then(() => "flushed");
      await called.promise;
      const first = await Promise.race([flushed, Bun.sleep(30).then(() => "waiting")]);
      release.resolve();
      await flushed;
      const s = Bun.otel.stats();
      console.log(first, JSON.stringify(exported), s.exportsSucceeded, s.exportsFailed, s.spansExported);
      `,
      {},
    );
    expect(stdout.trim()).toBe('waiting ["a"] 1 1 1');
    expect(exitCode).toBe(0);
  });

  test("a function exporter that throws is a warning and a failed export, not an uncaught exception", async () => {
    using dir = tempDir("otel-throwing-exporter", {
      "index.js": `Bun.otel.start({ exporters: [{ export() { throw new Error("boom"); } }] }); Bun.otel.tracer("t").startSpan("a").end(); await Bun.otel.forceFlush(); console.log("alive", Bun.otel.stats().exportsFailed);`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.trim()).toBe("alive 1");
    expect(stderr).toContain("exporter callback failed");
    expect(exitCode).toBe(0);
  });

  test("spans are flushed on process.exit() and after an uncaught exception", async () => {
    using c = collector();
    const a = await run(
      `Bun.otel.start({ endpoint: process.env.C }); Bun.otel.tracer("t").startSpan("exit0").end(); process.exit(0);`,
      { C: c.url },
    );
    expect(a.exitCode).toBe(0);
    const b = await run(
      `Bun.otel.start({ endpoint: process.env.C }); Bun.otel.tracer("t").startSpan("threw").end(); throw new Error("fatal");`,
      { C: c.url },
    );
    expect(b.exitCode).toBe(1);
    expect(
      c
        .spans()
        .map((s: any) => s.name)
        .sort(),
    ).toEqual(["exit0", "threw"]);
  });

  test("spans from a worker that alone called Bun.otel.start() are exported when the process exits", async () => {
    using c = collector();
    using dir = tempDir("otel-worker-only", {
      "w.js": `Bun.otel.start({ endpoint: process.env.C }); Bun.otel.tracer("w").startSpan("from-worker").end(); postMessage("done");`,
      "index.js": `const w = new Worker("./w.js"); await new Promise(r => (w.onmessage = r)); await w.terminate();`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      cwd: String(dir),
      env: { ...cleanEnv, C: c.url },
      stdout: "inherit",
      stderr: "inherit",
    });
    expect(await proc.exited).toBe(0);
    expect(c.spans().map((s: any) => s.name)).toEqual(["from-worker"]);
  });

  test("bunfig [otel] table enables and configures", async () => {
    using c = collector();
    using dir = tempDir("otel-bunfig", {
      "bunfig.toml": `[otel]\nendpoint = "${c.url}"\nserviceName = "from-bunfig"\n`,
      "index.js": `Bun.otel.tracer("t").startSpan("bf").end();`,
    });
    await using proc = Bun.spawn({ cmd: [bunExe(), "index.js"], cwd: String(dir), env: bunEnv, stderr: "pipe" });
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
    expect(c.spans().map((s: any) => s.name)).toEqual(["bf"]);
    const attrs = Object.fromEntries(
      c.received[0].body.resourceSpans[0].resource.attributes.map((a: any) => [a.key, Object.values(a.value)[0]]),
    );
    expect(attrs["service.name"]).toBe("from-bunfig");

    // OTEL_* environment wins over bunfig, including service.name via OTEL_RESOURCE_ATTRIBUTES
    using c2 = collector();
    await using proc2 = Bun.spawn({
      cmd: [bunExe(), "index.js"],
      cwd: String(dir),
      env: { ...bunEnv, OTEL_EXPORTER_OTLP_ENDPOINT: c2.url, OTEL_RESOURCE_ATTRIBUTES: "service.name=from-env" },
      stderr: "pipe",
    });
    const [, stderr2, exitCode2] = await Promise.all([proc2.stdout.text(), proc2.stderr.text(), proc2.exited]);
    expect(stderr2).toBe("");
    expect(exitCode2).toBe(0);
    const attrs2 = Object.fromEntries(
      c2.received[0].body.resourceSpans[0].resource.attributes.map((a: any) => [a.key, Object.values(a.value)[0]]),
    );
    expect(attrs2["service.name"]).toBe("from-env");
  });

  test("the headers of bunfig.toml go to its endpoint, and not to one that the environment names", async () => {
    using own = collector();
    using other = collector();
    using dir = tempDir("otel-bunfig-headers", {
      "bunfig.toml": `[otel]\nendpoint = "${own.url}"\nheaders = { "x-api-key" = "secret" }\n`,
      "index.js": `Bun.otel.span("s", () => {});`,
    });
    for (const env of [{}, { OTEL_EXPORTER_OTLP_ENDPOINT: other.url }]) {
      await using proc = Bun.spawn({ cmd: [bunExe(), "index.js"], cwd: String(dir), env: { ...cleanEnv, ...env } });
      expect(await proc.exited).toBe(0);
    }
    expect([own, other].map(c => c.received.map(r => r.headers["x-api-key"]))).toEqual([["secret"], [undefined]]);
  });

  test("start() takes headers, compression and the exporter from the environment; a list of exporters takes no headers", async () => {
    using c = collector();
    const env = { OTEL_EXPORTER_OTLP_HEADERS: "authorization=abc", OTEL_EXPORTER_OTLP_COMPRESSION: "gzip" };
    for (const options of [`{ endpoint: "${c.url}" }`, `{ exporters: ["${c.url}"] }`]) {
      expect(await run(`Bun.otel.start(${options}); Bun.otel.span("s", () => {});`, env)).toMatchObject({
        exitCode: 0,
      });
    }
    expect(c.received.map(r => [r.headers.authorization, r.headers["content-encoding"]])).toEqual([
      ["abc", "gzip"],
      [undefined, "gzip"],
    ]);
    // The default endpoint, seen from a proxy.
    using proxy = collector();
    await run(`Bun.otel.start(); Bun.otel.span("s", () => {});`, {
      ...env,
      OTEL_TRACES_EXPORTER: "otlp",
      HTTP_PROXY: proxy.url,
    });
    expect(proxy.received.map(r => [r.headers.host, r.headers.authorization])).toEqual([["localhost:4318", "abc"]]);
  });

  const neverTimesOut = { OTEL_BSP_EXPORT_TIMEOUT: "600000" };

  test("process.exit() hands every batch to a function exporter", async () => {
    const { stdout, stderr, exitCode } = await run(
      `Bun.otel.start({ exporters: [{ export(spans) { console.log(spans.length); } }], batch: { maxExportBatchSize: 50 } });
       for (let i = 0; i < 150; i++) Bun.otel.span("s", () => {});
       process.exit(0);`,
      neverTimesOut,
    );
    const sizes = stdout.trim().split("\n").map(Number);
    expect({ total: sizes.reduce((a, b) => a + b), largest: Math.max(...sizes), stderr, exitCode }).toEqual({
      total: 150,
      largest: 50,
      stderr: "",
      exitCode: 0,
    });
  });

  test("a function exporter may call process.exit()", async () => {
    const result = await run(
      `Bun.otel.start({ exporters: [{ export() { process.exit(7); } }] });
       Bun.otel.span("s", () => {});
       await Bun.otel.forceFlush();`,
      neverTimesOut,
    );
    expect(result).toEqual({ stdout: "", stderr: "", exitCode: 7 });
  });

  test("exit does not wait for the function exporter of a worker that is blocked", async () => {
    const result = await run(
      `if (Bun.isMainThread) {
         const worker = new Worker(import.meta.path);
         await new Promise(resolve => (worker.onmessage = resolve));
         Bun.otel.span("s", () => {});
         Bun.otel.forceFlush();
         process.exit(0);
       } else {
         Bun.otel.start({ exporters: [{ export() {} }] });
         postMessage("");
         Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
       }`,
      neverTimesOut,
    );
    expect(result).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  });

  test("the export at exit runs none of the program's pending microtasks", async () => {
    const result = await run(
      `Bun.otel.start({ exporters: [{ async export() { console.log("export"); await 0; } }] });
       Bun.otel.span("s", () => {});
       Promise.resolve().then(() => { console.log("too late"); process.exit(9); });
       process.exit(0);`,
      neverTimesOut,
    );
    expect(result).toEqual({ stdout: "export\n", stderr: expect.stringContaining("still pending"), exitCode: 0 });
  });

  test.each(["await Bun.otel.forceFlush()", "process.exit(0)"])(
    "a function exporter that start() replaces gets what was recorded before: %s",
    async ending => {
      const { stdout, exitCode } = await run(
        `const to = name => ({ export: spans => console.log(name, spans.map(s => s.name).join()) });
         Bun.otel.start({ exporters: [to("A")] });
         Bun.otel.span("before", () => {});
         Bun.otel.start({ exporters: [to("B")] });
         Bun.otel.span("after", () => {});
         ${ending};`,
        neverTimesOut,
      );
      expect({ stdout, exitCode }).toEqual({ stdout: "A before\nB after\n", exitCode: 0 });
    },
  );

  test.each(["process.exit(0)", "await Bun.otel.forceFlush()", "await Bun.otel.shutdown()"])(
    "%s exports what a worker that is still running has recorded",
    async ending => {
      using c = collector();
      const { exitCode } = await run(
        `if (Bun.isMainThread) {
           const worker = new Worker(import.meta.path);
           await new Promise(resolve => (worker.onmessage = resolve));
           ${ending};
           Bun.spawnSync([process.execPath, "-e", "process.kill(" + process.pid + ", 'SIGKILL')"], { env: { ...process.env, BUN_OTEL: "0" } });
         } else {
           Bun.otel.span("in the worker", () => {});
           postMessage("");
           setInterval(() => {}, 1000);
         }`,
        { BUN_OTEL: "1", OTEL_EXPORTER_OTLP_ENDPOINT: c.url },
      );
      expect(c.spans().map(s => s.name)).toEqual(["in the worker"]);
      expect(exitCode === 0).toBe(ending.includes("exit"));
    },
  );

  test("the main thread retries what a worker left behind", async () => {
    using c = collector(n => (n === 0 ? new Response(null, { status: 503 }) : undefined));
    const { exitCode } = await run(
      `if (Bun.isMainThread) {
         new Worker(import.meta.path);
         Bun.otel.start({ instrumentations: [] });
         while ((await (await fetch(process.env.OTEL_EXPORTER_OTLP_ENDPOINT)).json()) < 2) await Bun.sleep(20);
       } else {
         Bun.otel.span("s", () => {});
       }`,
      { BUN_OTEL: "1", OTEL_EXPORTER_OTLP_ENDPOINT: c.url, OTEL_BSP_SCHEDULE_DELAY: "50" },
    );
    expect([c.received.length, exitCode]).toEqual([2, 0]);
  });

  test("a worker may be terminated while it waits for forceFlush()", async () => {
    const result = await run(
      `if (Bun.isMainThread) {
         const worker = new Worker(import.meta.path);
         await new Promise(resolve => (worker.onmessage = resolve));
         await worker.terminate();
         console.log("terminated");
       } else {
         Bun.otel.start({ exporters: [{ export: () => new Promise(() => postMessage("")) }] });
         Bun.otel.span("s", () => {});
         await Bun.otel.forceFlush();
       }`,
      neverTimesOut,
    );
    expect(result).toEqual({ stdout: "terminated\n", stderr: "", exitCode: 0 });
  });

  test("forceFlush() waits for a batch that another thread is taking", async () => {
    using c = collector();
    const { stdout, exitCode } = await run(
      `let early = 0;
       for (let round = 1; round <= 200; round++) {
         for (let i = 0; i < 8; i++) Bun.otel.span("s", () => {});
         await Bun.otel.forceFlush();
         if (Bun.otel.stats().spansExported !== round * 8) early++;
       }
       console.log(early);`,
      { BUN_OTEL: "1", OTEL_EXPORTER_OTLP_ENDPOINT: c.url, OTEL_BSP_MAX_EXPORT_BATCH_SIZE: "4" },
    );
    expect({ stdout, exitCode }).toEqual({ stdout: "0\n", exitCode: 0 });
  });

  test("an export of a replaced exporter that never settles times out, and the next exporter goes on", async () => {
    const { stdout, exitCode } = await run(
      `const batch = { delayMs: 50, timeoutMs: 100 };
       const started = Promise.withResolvers(), second = Promise.withResolvers();
       Bun.otel.start({ batch, exporters: [{ export: () => (started.resolve(), new Promise(() => {})) }] });
       Bun.otel.span("a", () => {});
       const flushed = Bun.otel.forceFlush();
       await started.promise;
       Bun.otel.start({ batch, exporters: [{ export: spans => second.resolve(spans[0].name) }] });
       Bun.otel.span("b", () => {});
       const alive = setInterval(() => {}, 1000);
       console.log(await second.promise, await flushed, Bun.otel.stats().exportsFailed);
       clearInterval(alive);`,
      {},
    );
    expect({ stdout, exitCode }).toEqual({ stdout: "b undefined 1\n", exitCode: 0 });
  });

  test("exit does not chase the spans that busy workers keep recording", async () => {
    // Slower than the worker.
    using slow = Bun.serve({ port: 0, fetch: async req => (await req.bytes(), await Bun.sleep(5), new Response()) });
    const result = await run(
      `if (Bun.isMainThread) {
         const worker = new Worker(import.meta.path);
         await new Promise(resolve => (worker.onmessage = resolve));
         process.exit(0);
       } else {
         for (let i = 0; ; i++) Bun.otel.span("busy", () => i === 10 && postMessage(""));
       }`,
      { ...neverTimesOut, BUN_OTEL: "1", OTEL_EXPORTER_OTLP_ENDPOINT: slow.url.href },
    );
    expect(result).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  });

  test.each([
    ["begins at exit", ""],
    ["is in flight at exit", "Bun.otel.forceFlush(); await (await fetch(process.env.URL)).text();"],
  ])("an export that %s and fails gets one more try", async (_, begin) => {
    let posts = 0;
    const arrived = Promise.withResolvers<void>();
    using server = Bun.serve({
      port: 0,
      async fetch(req) {
        if (req.method === "GET") return arrived.promise.then(() => new Response());
        if (++posts > 1) return new Response();
        arrived.resolve();
        await Bun.sleep(100); // nothing tells that the child has begun to exit
        return new Response(null, { status: 503 });
      },
    });
    const result = await run(
      `Bun.otel.start({ endpoint: process.env.URL, instrumentations: [] });
       Bun.otel.span("s", () => {});
       ${begin}
       process.exit(0);`,
      { URL: server.url.href },
    );
    expect({ ...result, posts }).toEqual({ stdout: "", stderr: "", exitCode: 0, posts: 2 });
  });

  test("a queue of many batches, of requests and of several scopes, leaves whole", async () => {
    const { stdout, exitCode } = await run(
      `const seen = [], sizes = new Set(), release = Promise.withResolvers();
       Bun.otel.start({
         instrumentations: ["http"],
         batch: { maxExportBatchSize: 7 },
         exporters: [{ export: spans => (sizes.add(spans.length <= 7), seen.push(...spans.map(s => s.attributes["url.path"] ?? s.name)), release.promise) }],
       });
       const server = Bun.serve({ port: 0, routes: { "/*": new Response() } });
       for (let i = 0; i < 40; i++) {
         await fetch(server.url + "r" + i);
         Bun.otel.tracer("t" + (i % 3)).startSpan("s" + i).end();
       }
       release.resolve();
       await Bun.otel.forceFlush();
       server.stop(true);
       console.log(seen.length, new Set(seen).size, [...sizes].join());`,
      {},
    );
    expect({ stdout, exitCode }).toEqual({ stdout: "80 80 true\n", exitCode: 0 });
  });

  test("a span waits one delay at most", async () => {
    const { stdout, exitCode } = await run(
      `let exported = Promise.withResolvers();
       Bun.otel.start({ batch: { delayMs: 600 }, exporters: [{ export: () => exported.resolve() }] });
       Bun.otel.span("a", () => {});
       const alive = setInterval(() => {}, 1000);
       await exported.promise;
       exported = Promise.withResolvers();
       await Bun.sleep(50); // well inside the next interval
       const begun = performance.now();
       Bun.otel.span("b", () => {});
       await exported.promise;
       clearInterval(alive);
       console.log(performance.now() - begun < 1000);`,
      {},
    );
    expect({ stdout, exitCode }).toEqual({ stdout: "true\n", exitCode: 0 });
  });

  test("credentials in the endpoint are sent, and a timeout of 0 is no limit", async () => {
    using c = collector();
    const result = await run(`Bun.otel.span("s", () => {});`, {
      BUN_OTEL: "1",
      OTEL_EXPORTER_OTLP_ENDPOINT: c.url.replace("//", "//user:p%40ss@"),
      OTEL_EXPORTER_OTLP_TIMEOUT: "0",
      OTEL_BSP_EXPORT_TIMEOUT: "0",
    });
    expect(result).toEqual({ stdout: "", stderr: "", exitCode: 0 });
    expect(c.received.map(r => r.headers.authorization)).toEqual(["Basic " + btoa("user:p@ss")]);
  });

  test.skipIf(isWindows)("a process that kills itself exports first", async () => {
    using c = collector();
    await run(`Bun.otel.span("s", () => {}); process.kill(process.pid, "SIGTERM"); setInterval(() => {}, 1000);`, {
      BUN_OTEL: "1",
      OTEL_EXPORTER_OTLP_ENDPOINT: c.url,
    });
    expect(c.spans().map(s => s.name)).toEqual(["s"]);
  });

  test.each([
    [{}, "false"],
    [{ BUN_OTEL: "1", OTEL_TRACES_EXPORTER: "none" }, "true"],
  ])("bun test --isolate: start() ends with its file (%j)", async (env, records) => {
    using dir = tempDir("otel-isolate-start", {
      "a.test.js": `import { test } from "bun:test"; test("a", () => Bun.otel.start({ exporters: [], sampler: "always_off" }));`,
      "b.test.js": `import { test } from "bun:test"; test("b", () => console.log(Bun.otel.enabled, Bun.otel.span("s", s => s.isRecording())));`,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--isolate", "./a.test.js", "./b.test.js"],
      cwd: String(dir),
      env: { ...cleanEnv, ...env },
      stderr: "ignore",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout).toEndWith(`${records} ${records}\n`);
    expect(exitCode).toBe(0);
  });

  test("bun test --isolate: a flush that nobody waits for does not keep its file", async () => {
    using hangs = Bun.serve({ port: 0, idleTimeout: 0, fetch: () => new Promise(() => {}) });
    const file = (start: string) => `import { test } from "bun:test";
      test("t", () => {
        Bun.gc(true);
        console.log(require("bun:jsc").heapStats().protectedObjectTypeCounts.Promise ?? 0);
        ${start}
        Bun.otel.span("s", () => {});
        for (let i = 0; i < 50; i++) Bun.otel.forceFlush();
      });`;
    using dir = tempDir("otel-isolate-flush", {
      "a.test.js": file(
        `Bun.otel.start({ endpoint: ${JSON.stringify(hangs.url.href)}, batch: { timeoutMs: 600000 } });`,
      ),
      "b.test.js": file(""),
      "c.test.js": file(""),
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--isolate", "./a.test.js", "./b.test.js", "./c.test.js"],
      cwd: String(dir),
      env: cleanEnv,
      stderr: "ignore",
    });
    let stdout = "";
    for await (const chunk of proc.stdout) {
      if ((stdout += Buffer.from(chunk).toString()).match(/^\d+$/gm)?.length === 3) break;
    }
    // It waits for the collector.
    proc.kill("SIGKILL");
    const [a, b, c] = stdout.match(/^\d+$/gm)!.map(Number);
    expect(Math.max(b, c) - a).toBeLessThan(10);
  });

  test("an exporter that calls start() at exit does not take the batch from the others", async () => {
    const { stdout, exitCode } = await run(
      `const exporter = (name, then) => ({ export(spans) { console.log(name, spans.length); then?.(); } });
       Bun.otel.start({ exporters: [exporter("a", () => Bun.otel.start({ exporters: [exporter("c")] })), exporter("b")] });
       Bun.otel.span("s", () => {});`,
      {},
    );
    expect(stdout).toBe("a 1\nb 1\n");
    expect(exitCode).toBe(0);
  });

  test("an uncaught error is printed the same with tracing on", async () => {
    const script = `function boom() { throw new TypeError("x"); }\nBun.otel.span("a", boom);`;
    const printed = async (env: Record<string, string>) =>
      (await run(script, env)).stderr.replace(/\S*otel-exporter\S*?index/g, "index");
    expect(await printed({ BUN_OTEL: "1", OTEL_TRACES_EXPORTER: "none" })).toBe(await printed({}));
  });

  test("exit from a callback that holds up the HTTP thread does not wait for it", async () => {
    using stream = Bun.serve({
      port: 0,
      fetch: req =>
        req.method === "POST"
          ? new Response()
          : new Response(new ReadableStream({ pull: async c => (await Bun.sleep(1), c.enqueue("<p></p>")) })),
    });
    const { exitCode } = await run(
      `Bun.otel.span("s", () => {});
       let n = 0;
       // The sleep lets the next chunk arrive.
       const element = () => ++n === 5 && (Bun.sleepSync(50), process.exit(0));
       await new HTMLRewriter().on("p", { element }).transform(await fetch(process.env.URL)).text();`,
      {
        BUN_OTEL: "1",
        OTEL_EXPORTER_OTLP_ENDPOINT: stream.url.href,
        OTEL_EXPORTER_OTLP_TIMEOUT: "0",
        OTEL_BSP_EXPORT_TIMEOUT: "0",
        URL: stream.url.href,
        // Tearing the VM down waits for the HTTP thread too, with or without tracing.
        BUN_DESTRUCT_VM_ON_EXIT: "0",
        ASAN_OPTIONS: withoutLeakCheck,
      },
    );
    expect(exitCode).toBe(0);
  }, 20_000);

  test("exports do not take the connections of fetch()", async () => {
    let exports = 0;
    const [exporting, fetched] = [Promise.withResolvers<void>(), Promise.withResolvers<void>()];
    using server = Bun.serve({
      port: 0,
      idleTimeout: 0,
      routes: {
        "/exporting": () => exporting.promise.then(() => new Response()),
        "/fetch": () => (fetched.resolve(), new Response("ok")),
      },
      fetch() {
        if (++exports === 2) exporting.resolve();
        return fetched.promise.then(() => new Response());
      },
    });
    const result = await run(
      `Bun.otel.start({ exporters: [process.env.URL + "a", process.env.URL + "b"], instrumentations: [] });
       const exporting = fetch(process.env.URL + "exporting");
       Bun.otel.span("s", () => {});
       Bun.otel.forceFlush();
       await (await exporting).text();
       console.log(await (await fetch(process.env.URL + "fetch")).text());`,
      {
        URL: server.url.href,
        BUN_CONFIG_MAX_HTTP_REQUESTS: "2",
        ...neverTimesOut,
        OTEL_EXPORTER_OTLP_TIMEOUT: "600000",
      },
    );
    expect(result).toEqual({ stdout: "ok\n", stderr: "", exitCode: 0 });
  });

  test("exports do not wait for the connections of fetch()", async () => {
    using server = Bun.serve({
      port: 0,
      idleTimeout: 0,
      fetch: req => (req.url.endsWith("/hang") ? new Promise<Response>(() => {}) : new Response("ok")),
    });
    const { stdout } = await run(
      `Bun.otel.start({ endpoint: process.env.URL, instrumentations: [] });
       for (let i = 0; i < 4; i++) fetch(process.env.URL + "hang");
       Bun.otel.span("s", () => {});
       await Bun.otel.forceFlush();
       console.log(Bun.otel.stats().spansExported);
       process.exit(0);`,
      { URL: server.url.href, BUN_CONFIG_MAX_HTTP_REQUESTS: "2", ...neverTimesOut },
    );
    expect(stdout).toBe("1\n");
  });

  test("a worker may end while the main thread is exiting", async () => {
    const result = await run(
      `const { Worker, isMainThread, workerData, parentPort } = require("node:worker_threads");
       if (isMainThread) {
         const shared = new Int32Array(new SharedArrayBuffer(8));
         Bun.otel.start({ exporters: [{ export(spans) {
           console.log(spans.map(s => s.name).join());
           Atomics.store(shared, 0, 1); Atomics.notify(shared, 0); Atomics.wait(shared, 1, 0);
         } }] });
         new Worker(__filename, { workerData: shared }).on("message", () => { Bun.otel.span("main", () => {}); process.exit(0); });
       } else {
         parentPort.postMessage(1);
         Atomics.wait(workerData, 0, 0);
         Bun.otel.span("worker", () => {});
         process.on("exit", () => { Atomics.store(workerData, 1, 1); Atomics.notify(workerData, 1); });
       }`,
      neverTimesOut,
    );
    expect(result).toEqual({ stdout: "main\nworker\n", stderr: "", exitCode: 0 });
  });

  test.each(["process.exit(3)", `throw new Error("x")`])(
    "a worker's function exporter is called at %s",
    async ending => {
      const { stdout } = await run(
        `if (Bun.isMainThread) {
         const worker = new Worker(import.meta.path);
         worker.onerror = () => {};
         await new Promise(resolve => worker.addEventListener("close", resolve));
       } else {
         Bun.otel.start({ exporters: [{ export: spans => console.log(spans[0].name) }] });
         Bun.otel.span("s", () => {});
         ${ending};
       }`,
        {},
      );
      expect(stdout).toBe("s\n");
    },
  );

  test("the export timeout does not wait for the delay", async () => {
    const { stdout } = await run(
      `Bun.otel.start({ batch: { timeoutMs: 50, delayMs: 600000 }, exporters: [{ export: () => new Promise(() => {}) }] });
       Bun.otel.span("s", () => {});
       await Bun.otel.forceFlush();
       console.log(Bun.otel.stats().exportsFailed);`,
      {},
    );
    expect(stdout).toBe("1\n");
  });

  test.skipIf(isWindows)("an exporter may exit while the process kills itself", async () => {
    const result = await run(
      `Bun.otel.start({ exporters: [{ export() { process.exit(4); } }] });
       Bun.otel.span("s", () => {});
       process.kill(process.pid, "SIGTERM");`,
      neverTimesOut,
    );
    expect(result).toEqual({ stdout: "", stderr: "", exitCode: 4 });
  });

  test.skipIf(isWindows)("process.execve() exports first", async () => {
    using c = collector();
    await run(`Bun.otel.span("s", () => {}); process.execve(process.execPath, [process.execPath, "--version"], {});`, {
      BUN_OTEL: "1",
      OTEL_EXPORTER_OTLP_ENDPOINT: c.url,
    });
    expect(c.spans().map(s => s.name)).toEqual(["s"]);
  });

  test.skipIf(isWindows).each(["missing", "index.js/below"])(
    "process.execve(%j) leaves the retries to the program that goes on",
    async path => {
      using c = collector(n => (n < 2 ? new Response(null, { status: 503 }) : undefined));
      const result = await run(
        `Bun.otel.start({ endpoint: process.env.URL });
         Bun.otel.span("s", () => {});
         try { process.execve(${JSON.stringify(path)}, ["x"], {}); } catch (e) { console.log(e.code); }
         await Bun.otel.forceFlush();
         console.log(Bun.otel.stats().spansExported);`,
        { URL: c.url, NODE_NO_WARNINGS: "1" },
      );
      const code = path === "missing" ? "ENOENT" : "ENOTDIR";
      expect(result).toEqual({ stdout: code + "\n1\n", stderr: "", exitCode: 0 });
    },
  );

  test("bun test --isolate: a file's function exporter gets what the file has left", async () => {
    const file = (name: string) =>
      `import { test } from "bun:test";
       test("t", () => { Bun.otel.start({ exporters: [{ export: s => console.log(s[0].name) }] }); Bun.otel.span("${name}", () => {}); });`;
    using dir = tempDir("otel-isolate-left", { "a.test.js": file("a"), "b.test.js": file("b") });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--isolate", "./a.test.js", "./b.test.js"],
      cwd: String(dir),
      env: cleanEnv,
      stderr: "ignore",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout).toEndWith("a\nb\n");
    expect(exitCode).toBe(0);
  });

  test("the query of an endpoint is kept", async () => {
    using c = collector();
    for (const tail of ["?key=a", "/?key=a", "/own?key=a"]) {
      await run(`Bun.otel.start({ endpoint: "${c.url}${tail}" }); Bun.otel.span("s", () => {});`, {});
    }
    expect(c.received.map(r => r.url.slice(c.url.length))).toEqual([
      "/v1/traces?key=a",
      "/v1/traces?key=a",
      "/own?key=a",
    ]);
  });

  test("the debugger, whose URL is its password, is not traced", async () => {
    using c = collector();
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "--inspect=127.0.0.1:0/secret",
        "-e",
        `for await (const _ of console) break; Bun.otel.span("s", () => {});`,
      ],
      env: { ...cleanEnv, BUN_OTEL: "1", OTEL_EXPORTER_OTLP_ENDPOINT: c.url },
      stdin: "pipe",
      stderr: "pipe",
    });
    let printed = "";
    for await (const chunk of proc.stderr) if (/ws:\/\/\S+\s/.test((printed += Buffer.from(chunk)))) break;
    const ws = new WebSocket(/ws:\/\/\S+/.exec(Bun.stripANSI(printed))![0]);
    await new Promise((resolve, reject) => {
      ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "Runtime.enable" }));
      ws.onmessage = resolve;
      ws.onerror = reject;
    });
    ws.close();
    proc.stdin.end("\n");
    expect(await proc.exited).toBe(0);
    expect(c.spans().map(s => s.name)).toEqual(["s"]);
  });

  test.each(["Bun.otel.forceFlush()", ""])("exit ends while a worker keeps making batches due: %s", async flush => {
    using slow = Bun.serve({ port: 0, fetch: async req => (await req.bytes(), await Bun.sleep(80), new Response()) });
    const result = await run(
      `if (Bun.isMainThread) {
         const worker = new Worker(import.meta.path);
         await new Promise(resolve => (worker.onmessage = resolve));
         process.exit(0);
       } else {
         setInterval(() => { Bun.otel.span("s", () => {}); ${flush}; postMessage(""); }, 5);
       }`,
      { ...neverTimesOut, BUN_OTEL: "1", OTEL_EXPORTER_OTLP_ENDPOINT: slow.url.href, OTEL_BSP_SCHEDULE_DELAY: "1" },
    );
    expect(result).toEqual({ stdout: "", stderr: "", exitCode: 0 });
  });

  test("a batch that another thread is taking goes to the exporter that it was recorded under", async () => {
    const { stdout, exitCode } = await run(
      `let wrong = 0, total = 0;
       for (let round = 0; round < 100; round++) {
         const name = "round " + round;
         Bun.otel.start({
           batch: { maxExportBatchSize: 64 },
           exporters: [{ export(spans) { total += spans.length; wrong += spans.filter(s => s.name !== name).length; } }],
         });
         for (let i = 0; i < 64; i++) Bun.otel.span(name, () => {});
         if (round % 10 === 0) await Bun.otel.forceFlush();
       }
       await Bun.otel.forceFlush();
       console.log(total + Bun.otel.stats().spansDropped, Bun.otel.stats().spansDropped, wrong);`,
      {},
    );
    expect({ stdout, exitCode }).toEqual({ stdout: "6400 0 0\n", exitCode: 0 });
  });

  test("workers that end send no request of their own", async () => {
    let posts = 0;
    using hangs = Bun.serve({ port: 0, idleTimeout: 0, fetch: () => (posts++, new Promise<Response>(() => {})) });
    const { exitCode } = await run(
      `if (Bun.isMainThread) {
         for (let i = 0; i < 5; i++) await new Promise(resolve => new Worker(import.meta.path).addEventListener("close", resolve));
       } else {
         Bun.otel.span("s", () => {});
       }`,
      {
        BUN_OTEL: "1",
        OTEL_EXPORTER_OTLP_ENDPOINT: hangs.url.href,
        OTEL_BSP_SCHEDULE_DELAY: "600000",
        OTEL_BSP_EXPORT_TIMEOUT: "300",
      },
    );
    expect([exitCode, posts]).toEqual([0, 1]);
  });

  test.skipIf(isWindows)("exit does not wait past the timeout for a console exporter that cannot write", async () => {
    using dir = tempDir("otel-stuck-console", {});
    mkfifo(join(String(dir), "fifo"), 0o600);
    await using unread = await open(join(String(dir), "fifo"), "r+");
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const hangs = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
         Bun.otel.start({ exporters: ["console", "http://127.0.0.1:" + hangs.port], batch: { timeoutMs: 100 } });
         for (let i = 0; i < 700; i++) Bun.otel.span("s", { k: Buffer.alloc(4096, "a").toString() }, () => {});
         process.exit(0);`,
      ],
      env: cleanEnv,
      stderr: unread.fd,
    });
    expect(await proc.exited).toBe(0);
  });

  test("more batches than may be in flight wait for their turn, and lose no attempt", async () => {
    let inFlight = 0,
      most = 0;
    const full = Promise.withResolvers<void>();
    using slow = Bun.serve({
      port: 0,
      async fetch(req) {
        most = Math.max(most, ++inFlight);
        if (most === 8) full.resolve();
        await Promise.all([req.bytes(), full.promise]);
        inFlight--;
        return new Response();
      },
    });
    const { stdout, exitCode } = await run(
      `const options = { endpoint: process.env.URL, instrumentations: [], batch: { maxExportBatchSize: 1 } };
       Bun.otel.start(options);
       for (let i = 0; i < 30; i++) Bun.otel.span("s", () => {});
       Bun.otel.start(options); // hands them all out
       await Bun.otel.forceFlush();
       const { spansExported, spansDropped } = Bun.otel.stats();
       console.log(spansExported, spansDropped);`,
      { URL: slow.url.href },
    );
    expect({ stdout, exitCode, most }).toEqual({ stdout: "30 0\n", exitCode: 0, most: 8 });
  });

  test("the documents of the console exporter do not mix, whoever writes them", async () => {
    const { stderr, exitCode } = await run(
      `const record = () => { for (let i = 0; i < 300; i++) Bun.otel.span("s", { k: Buffer.alloc(2048, "a").toString() }, () => {}); };
       if (Bun.isMainThread) {
         Bun.otel.start({ exporters: ["console"], batch: { maxExportBatchSize: 64 } });
         record();
         await new Promise(resolve => new Worker(import.meta.path).addEventListener("close", resolve));
         record();
         process.exit(0);
       } else {
         Bun.otel.start({ exporters: ["console", { export() {} }], batch: { maxExportBatchSize: 64 } });
         record();
       }`,
      {},
    );
    const documents = stderr
      .trimEnd()
      .split("\n")
      .map(line => JSON.parse(line));
    expect(documents.flatMap(d => d.resourceSpans[0].scopeSpans[0].spans)).toHaveLength(900);
    expect(exitCode).toBe(0);
  });

  test("what a replaced exporter has parked takes no room from the next", async () => {
    using c = collector(() => new Response(null, { status: 429, headers: { "retry-after": "100" } }));
    const { stdout } = await run(
      `const batch = { maxQueueSize: 4 };
       Bun.otel.start({ endpoint: process.env.URL, instrumentations: [], batch });
       for (let i = 0; i < 4; i++) Bun.otel.span("old", () => {});
       await Bun.otel.forceFlush();
       Bun.otel.start({ exporters: [{ export: spans => console.log(spans[0].name) }], batch });
       Bun.otel.span("new", () => {});
       await Bun.otel.forceFlush();`,
      { URL: c.url },
    );
    expect(stdout).toBe("new\n");
  });

  test.skipIf(isWindows).each(["process.exit(0)", "await Bun.otel.forceFlush(); process.kill(process.pid, 9)"])(
    "exports do not need the work pool, which the program may have filled: %s",
    async ending => {
      using dir = tempDir("otel-full-pool", {});
      mkfifo(join(String(dir), "fifo"), 0o600);
      const { stderr } = await run(
        `Bun.otel.start({ exporters: ["console"], instrumentations: [] });
         const fs = require("node:fs");
         // Until a call that is quick otherwise finds no thread.
         do for (let i = 0; i < navigator.hardwareConcurrency; i++) fs.open(process.env.FIFO, "r", () => {});
         while (await Promise.race([fs.promises.stat("."), Bun.sleep(200)]));
         Bun.otel.span("s", () => {});
         ${ending};`,
        {
          ...neverTimesOut,
          FIFO: join(String(dir), "fifo"),
          BUN_DESTRUCT_VM_ON_EXIT: "0",
          ASAN_OPTIONS: withoutLeakCheck,
        },
      );
      expect(JSON.parse(stderr).resourceSpans[0].scopeSpans[0].spans[0].name).toBe("s");
    },
  );

  test.skipIf(isWindows)("a replaced console exporter that cannot write times out", async () => {
    using dir = tempDir("otel-replaced-console", {});
    mkfifo(join(String(dir), "fifo"), 0o600);
    await using unread = await open(join(String(dir), "fifo"), "r+");
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const batch = { timeoutMs: 100 };
         Bun.otel.start({ exporters: ["console"], batch });
         for (let i = 0; i < 100; i++) Bun.otel.span("s", { k: Buffer.alloc(4096, "a").toString() }, () => {});
         Bun.otel.start({ exporters: [{ export: spans => console.log(spans[0].name) }], batch });
         Bun.otel.span("new", () => {});
         await Bun.otel.forceFlush();`,
      ],
      env: cleanEnv,
      stderr: unread.fd,
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect({ stdout, exitCode }).toEqual({ stdout: "new\n", exitCode: 0 });
  });

  test("a collector that uses up the time at exit takes nothing from the other exporters", async () => {
    using hangs = Bun.serve({ port: 0, idleTimeout: 0, fetch: () => new Promise<Response>(() => {}) });
    using healthy = collector();
    const { stdout, stderr } = await run(
      `let n = 0;
       Bun.otel.start({
         exporters: [process.env.URL, "${healthy.url}", "console", { export: spans => console.log((n += spans.length)) }],
         batch: { timeoutMs: 1000, maxExportBatchSize: 2 },
       });
       for (let i = 0; i < 9; i++) Bun.otel.span("s", () => {});
       process.exit(0);`,
      { URL: hangs.url.href },
    );
    const documents = stderr.split("\n").filter(line => line.startsWith("{"));
    expect(documents.flatMap(d => JSON.parse(d).resourceSpans[0].scopeSpans[0].spans)).toHaveLength(9);
    expect(stdout).toEndWith("9\n");
    expect(healthy.spans()).toHaveLength(9);
    expect(stderr).toContain(hangs.url.origin + "/v1/traces at exit failed: no response in time");
  });

  test.skipIf(isWindows)("a console that cannot write holds a self-kill up once, not for each batch", async () => {
    using dir = tempDir("otel-stuck-kill", {});
    mkfifo(join(String(dir), "fifo"), 0o600);
    await using unread = await open(join(String(dir), "fifo"), "r+");
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `Bun.otel.start({ exporters: ["console"], batch: { maxExportBatchSize: 1, timeoutMs: 600000 } });
         for (let i = 0; i < 1000; i++) Bun.otel.span("s", { k: Buffer.alloc(1024, "a").toString() }, () => {});
         process.kill(process.pid, "SIGTERM");`,
      ],
      env: cleanEnv,
      stderr: unread.fd,
    });
    await proc.exited;
    expect(proc.signalCode).toBe("SIGTERM");
  });

  test("neither a warning nor a function exporter writes into a document of the console at exit", async () => {
    using refuses = collector(() => new Response(null, { status: 401 }));
    const { stderr } = await run(
      `Bun.otel.start({ exporters: ["console", process.env.URL, { export() { console.error("function"); } }] });
       for (let i = 0; i < 512; i++) Bun.otel.span("s", { k: Buffer.alloc(4096, "a").toString() }, () => {});
       process.exit(0);`,
      { URL: refuses.url },
    );
    const lines = stderr.trimEnd().split("\n");
    expect(lines.map(line => (line[0] === "{" ? typeof JSON.parse(line) : line.slice(0, 8))).sort()).toEqual([
      "function",
      "object",
      "warn: [o",
    ]);
  });

  test("a function exporter that exits during the exit does not cut off the collector", async () => {
    using c = collector();
    const { exitCode } = await run(
      `Bun.otel.start({ exporters: [{ export() { process.exit(5); } }, process.env.URL] });
       Bun.otel.span("s", () => {});`,
      { URL: c.url },
    );
    expect([exitCode, c.spans().length]).toEqual([5, 1]);
  });

  test("a request that was sent before the exit and times out gets one more try", async () => {
    let posts = 0;
    const arrived = Promise.withResolvers<void>();
    using server = Bun.serve({
      port: 0,
      idleTimeout: 0,
      fetch(req) {
        if (req.method === "GET") return arrived.promise.then(() => new Response());
        if (++posts > 1) return new Response();
        arrived.resolve();
        return new Promise<Response>(() => {});
      },
    });
    const result = await run(
      `Bun.otel.start({ exporters: [{ url: process.env.URL, timeoutMs: 1500 }], instrumentations: [] });
       Bun.otel.span("s", () => {});
       Bun.otel.forceFlush();
       await (await fetch(process.env.URL)).text();
       process.exit(0);`,
      { URL: server.url.href },
    );
    expect([result.exitCode, posts]).toEqual([0, 2]);
  });

  test("at exit nothing is dropped for want of room to wait", async () => {
    let received = 0;
    const full = Promise.withResolvers<void>();
    using slow = Bun.serve({
      port: 0,
      async fetch(req) {
        if (req.method === "GET") return full.promise.then(() => new Response());
        if (++received === 8) full.resolve();
        await Promise.all([req.bytes(), Bun.sleep(100)]); // nothing tells that the child has begun to exit
        return new Response();
      },
    });
    const { exitCode } = await run(
      `const batch = { maxQueueSize: 20, maxExportBatchSize: 1 };
       Bun.otel.start({ endpoint: process.env.URL, instrumentations: [], batch });
       for (let i = 0; i < 20; i++) Bun.otel.span("s", () => {});
       Bun.otel.start({ instrumentations: [], batch }); // hands them all out
       await (await fetch(process.env.URL)).text();
       for (let i = 0; i < 20; i++) Bun.otel.span("s", () => {});
       process.exit(0);`,
      { URL: slow.url.href },
    );
    expect([exitCode, received]).toEqual([0, 40]);
  });

  test.each([{}, { "retry-after": "0" }])(
    "what a collector refuses at exit for being sent too much at once is sent as it accepts the rest: %j",
    async headers => {
      let inFlight = 0,
        accepted = 0;
      using limits = Bun.serve({
        port: 0,
        async fetch(req) {
          await req.bytes();
          if (inFlight === 1) return new Response(null, { status: 429, headers });
          inFlight++;
          await Bun.sleep(100); // for the others to be refused meanwhile
          inFlight--;
          accepted++;
          return new Response();
        },
      });
      const result = await run(
        `Bun.otel.start({ endpoint: process.env.URL, batch: { maxExportBatchSize: 1 } });
         for (let i = 0; i < 4; i++) Bun.otel.span("s", () => {});
         process.exit(0);`,
        { URL: limits.url.href },
      );
      expect({ ...result, accepted }).toEqual({ stdout: "", stderr: "", exitCode: 0, accepted: 4 });
    },
  );

  test("a warning is written by the time that forceFlush() resolves", async () => {
    const { stderr } = await run(
      `Bun.otel.start({ exporters: [{ export() { throw new Error("boom"); } }] });
       Bun.otel.span("s", () => {});
       await Bun.otel.forceFlush();
       console.error("flushed");`,
      {},
    );
    expect(stderr).toBe(
      "warn: [otel] exporter callback failed: boom\nflushed\n".replaceAll("\n", stderr.includes("\r") ? "\r\n" : "\n"),
    );
  });

  test("the last try at exit does not wait for another collector that hangs", async () => {
    let posts = 0;
    const retried = Promise.withResolvers<void>();
    using hangs = Bun.serve({ port: 0, fetch: () => retried.promise.then(() => new Response()) });
    using refusesOnce = collector(() => {
      if (++posts === 1) return new Response(null, { status: 503 });
      retried.resolve();
      return new Response();
    });
    const result = await run(
      `Bun.otel.start({ exporters: [process.env.HANGS, process.env.URL] });
       Bun.otel.span("s", () => {});
       process.exit(0);`,
      { HANGS: hangs.url.href, URL: refusesOnce.url },
    );
    expect({ ...result, posts }).toEqual({ stdout: "", stderr: "", exitCode: 0, posts: 2 });
  });

  test("the last tries at exit do not wait for one another", async () => {
    let posts = 0;
    const all = Promise.withResolvers<void>();
    using recovers = Bun.serve({
      port: 0,
      idleTimeout: 0,
      async fetch(req) {
        await req.bytes();
        if (++posts <= 3) return new Response(null, { status: 503, headers: { "retry-after": "100" } });
        if (posts === 6) all.resolve();
        await all.promise;
        return new Response();
      },
    });
    const result = await run(
      `Bun.otel.start({ endpoint: process.env.URL, batch: { maxExportBatchSize: 1 } });
       for (let i = 0; i < 3; i++) Bun.otel.span("s", () => {});
       await Bun.otel.forceFlush();
       process.exit(0);`,
      { URL: recovers.url.href },
    );
    expect({ ...result, posts }).toEqual({ stdout: "", stderr: "", exitCode: 0, posts: 6 });
  });

  test.skipIf(isWindows)("a warning that cannot be written blocks neither fetch() nor the exit", async () => {
    using dir = tempDir("otel-stuck-warning", {});
    mkfifo(join(String(dir), "fifo"), 0o600);
    await using unread = await open(join(String(dir), "fifo"), "r+");
    using refuses = collector(() => new Response(null, { status: 401 }));
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `process.stderr.write(Buffer.alloc(1024 * 1024, "a"));
         Bun.otel.start({ exporters: [process.env.URL, { export() { throw new Error("boom"); } }], instrumentations: [] });
         Bun.otel.span("s", () => {});
         await Bun.otel.forceFlush();
         console.log(await (await fetch(process.env.URL + "/count")).text());
         process.exit(0);`,
      ],
      env: { ...cleanEnv, URL: refuses.url },
      stderr: unread.fd,
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect({ stdout, exitCode }).toEqual({ stdout: "1\n", exitCode: 0 });
  });

  test.skipIf(isWindows)("a slow reader of stderr holds the program up for one warning, not for each", async () => {
    using dir = tempDir("otel-slow-warnings", {});
    mkfifo(join(String(dir), "fifo"), 0o600);
    const { stdout } = await run(
      `const fs = require("node:fs");
       const fifo = fs.openSync(process.env.FIFO, fs.constants.O_RDWR | fs.constants.O_NONBLOCK);
       const repeat = f => { try { for (;;) f(); } catch {} };
       const child = Bun.spawn({
         cmd: [process.execPath, "-e", \`
           Bun.otel.start({ exporters: [{ export() { throw new Error("boom"); } }], instrumentations: [] });
           process.on("message", async () => {
             const began = performance.now();
             Bun.otel.span("s", () => {});
             await Bun.otel.forceFlush();
             process.send(performance.now() - began);
           });\`],
         stderr: fs.openSync(process.env.FIFO, "w"),
         ipc: took => next.resolve(took),
       });
       let next, seen = "";
       const buffer = Buffer.alloc(65536);
       const slow = [];
       for (let i = 1; i <= 4; i++) {
         repeat(() => fs.writeSync(fifo, "a"));
         next = Promise.withResolvers();
         child.send("go");
         slow.push((await next.promise) >= 240);
         while (seen.split("boom").length <= i) {
           repeat(() => (seen += buffer.latin1Slice(0, fs.readSync(fifo, buffer)).replaceAll("a", "")));
           await Bun.sleep(5);
         }
         await Bun.sleep(20); // nothing tells that the writer is idle again
       }
       child.kill(9);
       console.log(slow.filter(Boolean).length);`,
      { FIFO: join(String(dir), "fifo") },
    );
    expect(Number(stdout)).toBeWithin(1, 3); // a busy machine may add one
  });
});
