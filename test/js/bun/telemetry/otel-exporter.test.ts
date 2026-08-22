import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
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

async function run(script: string, env: Record<string, string>) {
  using dir = tempDir("otel-exporter", { "index.js": script });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "index.js"],
    cwd: String(dir),
    env: { ...bunEnv, ...env },
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
    expect(r.headers["user-agent"]).toMatch(/^Bun\/.+ OTLP-Exporter$/);
    const attrs = Object.fromEntries(
      r.body.resourceSpans[0].resource.attributes.map((a: any) => [a.key, Object.values(a.value)[0]]),
    );
    expect(attrs).toMatchObject({
      "service.name": "env-svc",
      "deployment.environment": "ci",
      team: "runtime",
      "telemetry.sdk.name": "bun",
      "process.runtime.name": "bun",
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

  test("unreachable collector: retried export does not stall process exit", async () => {
    // Nothing listens on this port: the export fails (retryable) and is parked;
    // exit must not wait out OTEL_BSP_EXPORT_TIMEOUT for it.
    const dead = Bun.serve({ port: 0, fetch: () => new Response("x") });
    const port = dead.port;
    dead.stop(true);
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

  test("vendor presets: endpoint path and auth headers", async () => {
    using c = collector();
    const script = `
      Bun.otel.start({
        serviceName: "presets",
        exporters: [
          { type: "datadog", apiKey: "ddkey", endpoint: process.env.C },
          { type: "honeycomb", apiKey: "hckey", id: "classic-ds", endpoint: process.env.C },
          { type: "grafana", apiKey: "tok", id: "12345", endpoint: process.env.C + "/otlp" },
          { type: "newrelic", apiKey: "nrkey", endpoint: process.env.C },
          { type: "axiom", apiKey: "axtok", id: "ds", endpoint: process.env.C },
          { type: "dynatrace", apiKey: "dttok", endpoint: process.env.C + "/api/v2/otlp" },
          { type: "sentry", apiKey: "pub", endpoint: process.env.C + "/api/7/integration/otlp/v1/traces" },
          { type: "otlp", endpoint: process.env.C },
        ],
      });
      Bun.otel.tracer("t").startSpan("s").end();
      await Bun.otel.forceFlush();
    `;
    const { exitCode, stderr } = await run(script, { C: c.url });
    expect(stderr).toBe("");
    const got = c.received.map(r => [new URL(r.url).pathname, r.headers]);
    const by = (path: string, h: string) =>
      got.find(([p, hs]) => p === path && (h === "" || h in (hs as any)))?.[1] as any;
    expect(by("/v1/traces", "dd-api-key")["dd-api-key"]).toBe("ddkey");
    expect(by("/v1/traces", "x-honeycomb-team")).toMatchObject({
      "x-honeycomb-team": "hckey",
      "x-honeycomb-dataset": "classic-ds",
    });
    expect(by("/otlp/v1/traces", "authorization").authorization).toBe("Basic " + btoa("12345:tok"));
    expect(by("/v1/traces", "api-key")["api-key"]).toBe("nrkey");
    expect(by("/v1/traces", "x-axiom-dataset")).toMatchObject({
      authorization: "Bearer axtok",
      "x-axiom-dataset": "ds",
    });
    expect(by("/api/v2/otlp/v1/traces", "authorization").authorization).toBe("Api-Token dttok");
    expect(by("/api/7/integration/otlp/v1/traces", "x-sentry-auth")["x-sentry-auth"]).toBe("sentry sentry_key=pub");
    expect(got.filter(([p]) => p === "/v1/traces").length).toBe(5);
    expect(c.received.every(r => r.headers["content-encoding"] === "gzip")).toBe(true);
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

  test("BUN_OTEL_EXPORTER preset from env (datadog via local Agent address, honeycomb needs a key)", async () => {
    using c = collector();
    const { exitCode, stderr } = await run(`Bun.otel.tracer("t").startSpan("s").end();`, {
      BUN_OTEL: "1",
      BUN_OTEL_EXPORTER: "datadog,honeycomb",
      DD_OTLP_ENDPOINT: c.url,
    });
    expect(stderr).toContain('exporter preset "honeycomb" needs apiKey');
    expect(c.received.length).toBe(1);
    expect(new URL(c.received[0].url).pathname).toBe("/v1/traces");
    expect(c.received[0].headers["dd-api-key"]).toBeUndefined();
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

  test("bunfig [telemetry] table enables and configures", async () => {
    using c = collector();
    using dir = tempDir("otel-bunfig", {
      "bunfig.toml": `[telemetry]\nenabled = true\nendpoint = "${c.url}"\nserviceName = "from-bunfig"\n`,
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
  });
});
