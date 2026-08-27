import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { basename } from "node:path";
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
    // so 1.5 s later it has not been retried; forceFlush() then retries it now.
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
    expect(stdout.trim()).toBe(JSON.stringify([1, 2, 1]));
    expect(exitCode).toBe(0);
  });

  test("after a forceFlush(), later failed exports keep their backoff (are not retried in a burst)", async () => {
    // Batch 1 succeeds and is flushed. Batch 2 then gets 503s: it must be
    // parked for its backoff, not burned through every attempt at once.
    let n = 0;
    using c = collector(i => (n++, i === 0 ? undefined : new Response("busy", { status: 503 })));
    const { stdout, exitCode } = await run(
      `
        Bun.otel.start({ endpoint: process.env.COLLECTOR, batch: { delayMs: 10 }, instrumentations: [] });
        Bun.otel.tracer("t").startSpan("first").end();
        await Bun.otel.forceFlush();
        Bun.otel.tracer("t").startSpan("second").end();
        // wait until the first 503 has parked the payload, then give a burst
        // (which would go through all attempts back to back) time to show
        const t0 = Date.now();
        while ((await (await fetch(process.env.COLLECTOR + "/count")).json()) < 2 && Date.now() - t0 < 5000) await Bun.sleep(5);
        await Bun.sleep(200); // < the first backoff step (1 s)
        console.log(JSON.stringify(Bun.otel.stats()));
        process.exit(0);
      `,
      { COLLECTOR: c.url, OTEL_BSP_EXPORT_TIMEOUT: "1" },
    );
    const stats = JSON.parse(stdout.trim());
    // one success, then a single parked attempt for "second" (not 5 in a row;
    // exit may make one more): a burst would have failed the export by now.
    expect([stats.exportsSucceeded, stats.exportsFailed]).toEqual([1, 0]);
    expect(c.received.length).toBeLessThanOrEqual(3);
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
    const started = performance.now();
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
        OTEL_BSP_EXPORT_TIMEOUT: "30000",
      },
    );
    expect(performance.now() - started).toBeLessThan(15_000);
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
       await Bun.sleep(150);
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
      let resolveExport;
      const exported = [];
      Bun.otel.start({ exporters: [{ async export(spans) { await new Promise(r => (resolveExport = r)); exported.push(...spans.map(s => s.name)); } }, { async export() { await 1; throw new Error("flaky"); } }] });
      process.on("unhandledRejection", () => { console.log("UNHANDLED"); });
      Bun.otel.tracer("t").startSpan("a").end();
      const flushed = Bun.otel.forceFlush().then(() => "flushed");
      const first = await Promise.race([flushed, Bun.sleep(30).then(() => "waiting")]);
      resolveExport();
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
});
