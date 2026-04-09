import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Helper: spawn a subprocess that runs an in-process OTLP collector + the
// given `body`, then prints `JSON.stringify(report(allSpans))`. Spans are
// flattened across resourceSpans/scopeSpans with `.scope` attached.
async function runWithCollector(
  body: string,
  report: string,
  extraEnv: Record<string, string | undefined> = {},
): Promise<unknown> {
  const script = /* js */ `
    let received = [];
    const { promise, resolve } = Promise.withResolvers();
    let resolved = false;
    using collector = Bun.serve({
      port: 0,
      async fetch(req) {
        if (new URL(req.url).pathname !== "/v1/traces") return new Response("no", { status: 404 });
        const body = new Uint8Array(await req.arrayBuffer());
        received.push(Bun.otel.decodeTraces(body));
        if (!resolved) { resolved = true; resolve(); }
        return new Response(new Uint8Array(0), { headers: { "content-type": "application/x-protobuf" } });
      },
    });
    globalThis.__collectorPort = collector.port;
    globalThis.__waitCollector = (n = 1) => {
      if (received.length >= n) return Promise.resolve();
      return promise;
    };
    globalThis.__allSpans = () => received.flatMap(r => r.resourceSpans?.[0]?.scopeSpans?.flatMap(ss => (ss.spans ?? []).map(s => ({...s, scope: ss.scope?.name}))) ?? []);
    globalThis.__attr = (s, k) => s?.attributes?.find(a => a.key === k)?.value;
    ${body}
    await Bun.otel.forceFlush();
    if (received.length > 0) await __waitCollector();
    const allSpans = __allSpans();
    const attr = __attr;
    console.log(JSON.stringify((${report})));
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: { ...bunEnv, OTEL_EXPORTER_OTLP_ENDPOINT: undefined, ...extraEnv },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr.trim()).toBe("");
  expect(exitCode).toBe(0);
  return JSON.parse(stdout.trim());
}

describe("Bun.otel instrument flags", () => {
  test.concurrent("instrument:{serve:false} suppresses Bun.serve spans; default produces them", async () => {
    const body = (serve: boolean) => /* js */ `
      Bun.otel.configure({ endpoint: "http://127.0.0.1:" + __collectorPort, scheduledDelayMillis: 60_000, instrument: { serve: ${serve} } });
      using app = Bun.serve({ port: 0, fetch() { return new Response("ok"); } });
      await fetch(app.url);
    `;
    const off = await runWithCollector(
      body(false),
      `{ serveSpans: allSpans.filter(s => s.scope === "bun.serve").length, fetchSpans: allSpans.filter(s => s.scope === "bun.fetch").length }`,
    );
    expect(off).toEqual({ serveSpans: 0, fetchSpans: 1 });

    const on = await runWithCollector(
      body(true),
      `{ serveSpans: allSpans.filter(s => s.scope === "bun.serve").length }`,
    );
    expect(on).toEqual({ serveSpans: 1 });
  });

  test.concurrent("OTEL_BUN_DISABLED_INSTRUMENTATIONS env disables named hooks", async () => {
    const result = await runWithCollector(
      /* js */ `
        Bun.otel.configure({ endpoint: "http://127.0.0.1:" + __collectorPort, scheduledDelayMillis: 60_000 });
        using app = Bun.serve({ port: 0, fetch() { return new Response("ok"); } });
        await fetch(app.url);
      `,
      `{ serve: allSpans.filter(s => s.scope === "bun.serve").length, fetch: allSpans.filter(s => s.scope === "bun.fetch").length }`,
      { OTEL_BUN_DISABLED_INSTRUMENTATIONS: "fetch,serve" },
    );
    expect(result).toEqual({ serve: 0, fetch: 0 });
  });

  test.concurrent("node:http server span", async () => {
    const result = await runWithCollector(
      /* js */ `
        Bun.otel.configure({ endpoint: "http://127.0.0.1:" + __collectorPort, scheduledDelayMillis: 60_000, instrument: { fetch: false } });
        const http = require("node:http");
        const srv = http.createServer((req, res) => { res.end("hi"); });
        await new Promise(r => srv.listen(0, r));
        const port = srv.address().port;
        const res = await fetch("http://127.0.0.1:" + port + "/route?x=1", {
          headers: { traceparent: "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01" },
        });
        await res.text();
        await new Promise(r => srv.close(r));
      `,
      `(() => {
        const s = allSpans.find(s => s.scope === "node.http");
        return {
          got: !!s,
          scope: s?.scope,
          kind: s?.kind,
          method: attr(s, "http.request.method")?.stringValue,
          path: attr(s, "url.path")?.stringValue,
          inheritedTrace: s?.traceId === "4bf92f3577b34da6a3ce929d0e0e4736",
          parent: s?.parentSpanId,
        };
      })()`,
    );
    expect(result).toEqual({
      got: true,
      scope: "node.http",
      kind: 2,
      method: "GET",
      path: "/route",
      inheritedTrace: true,
      parent: "00f067aa0ba902b7",
    });
  });

  test.concurrent(
    "HTTP semconv attrs: route, query, user-agent, server.port, status_code, client.address",
    async () => {
      const result = await runWithCollector(
        /* js */ `
        Bun.otel.configure({ endpoint: "http://127.0.0.1:" + __collectorPort, scheduledDelayMillis: 60_000, instrument: { fetch: true } });
        using app = Bun.serve({
          port: 0,
          routes: { "/u/:id": (req) => new Response("ok", { status: 201 }) },
        });
        await fetch(app.url + "u/42?k=v&x=1", { headers: { "user-agent": "probe/1.0" } });

        const http = require("node:http");
        const srv = http.createServer((req, res) => { res.writeHead(503); res.end("err"); });
        await new Promise(r => srv.listen(0, r));
        const nport = srv.address().port;
        await fetch("http://127.0.0.1:" + nport + "/hp?q=1").then(r => r.text());
        await new Promise(r => srv.close(r));
      `,
        `(() => {
        const sv = allSpans.find(s => s.scope === "bun.serve");
        const nh = allSpans.find(s => s.scope === "node.http");
        const fc = allSpans.filter(s => s.scope === "bun.fetch");
        return {
          serve: {
            route: attr(sv, "http.route")?.stringValue,
            path: attr(sv, "url.path")?.stringValue,
            query: attr(sv, "url.query")?.stringValue,
            ua: attr(sv, "user_agent.original")?.stringValue,
            hasPort: typeof attr(sv, "server.port")?.intValue === "string",
            hasClientAddr: typeof attr(sv, "client.address")?.stringValue === "string",
            status: attr(sv, "http.response.status_code")?.intValue,
          },
          nodeHttp: {
            status: attr(nh, "http.response.status_code")?.intValue,
            errType: attr(nh, "error.type")?.stringValue,
            query: attr(nh, "url.query")?.stringValue,
            hasPort: typeof attr(nh, "server.port")?.intValue === "string",
          },
          fetch: {
            allHavePort: fc.every(s => typeof attr(s, "server.port")?.intValue === "string"),
            errStatuses: fc.map(s => attr(s, "error.type")?.stringValue).filter(Boolean),
          },
        };
      })()`,
      );
      expect(result).toEqual({
        serve: {
          route: "/u/:id",
          path: "/u/42",
          query: "k=v&x=1",
          ua: "probe/1.0",
          hasPort: true,
          hasClientAddr: true,
          status: "201",
        },
        nodeHttp: { status: "503", errType: "503", query: "q=1", hasPort: true },
        fetch: { allHavePort: true, errStatuses: ["503"] },
      });
    },
  );

  test.concurrent("WebSocket client message span", async () => {
    const result = await runWithCollector(
      /* js */ `
        Bun.otel.configure({ endpoint: "http://127.0.0.1:" + __collectorPort, scheduledDelayMillis: 60_000, instrument: { websocket: true, fetch: false, serve: false } });
        let done; const doneP = new Promise(r => done = r);
        using app = Bun.serve({
          port: 0,
          fetch(req, server) { return server.upgrade(req) ? undefined : new Response("no", { status: 400 }); },
          websocket: { message(ws, msg) { ws.send("echo:" + msg); } },
        });
        const ws = new WebSocket("ws://127.0.0.1:" + app.port);
        let n = 0;
        ws.onmessage = (ev) => { if (++n === 2) { ws.close(); } };
        ws.onclose = () => done();
        await new Promise(r => { ws.onopen = r; });
        ws.send("aa");
        ws.send("bbb");
        await doneP;
      `,
      `(() => {
        const cli = allSpans.filter(s => s.scope === "websocket.client" && s.name === "ws message");
        const open = allSpans.find(s => s.scope === "websocket.client" && s.name === "ws open");
        return {
          clientMsgCount: cli.length,
          gotClientOpen: !!open,
          sizes: cli.map(m => Number(attr(m, "messaging.message.body.size")?.intValue ?? -1)).sort(),
          // server-side echoes: 2 server message spans too
          serverMsgCount: allSpans.filter(s => s.scope === "bun.websocket" && s.name === "ws message").length,
        };
      })()`,
    );
    expect(result).toEqual({
      clientMsgCount: 2,
      gotClientOpen: true,
      sizes: [7, 8], // "echo:aa".length=7, "echo:bbb".length=8
      serverMsgCount: 2,
    });
  });

  test.concurrent("node:fs readFile span (opt-in via instrument.fs)", async () => {
    using dir = tempDir("otel-fs", { "f.txt": "hello" });
    const p = String(dir) + "/f.txt";
    const off = await runWithCollector(
      /* js */ `
        Bun.otel.configure({ endpoint: "http://127.0.0.1:" + __collectorPort, scheduledDelayMillis: 60_000 });
        await require("node:fs").promises.readFile(${JSON.stringify(p)});
      `,
      `{ fsSpans: allSpans.filter(s => s.scope === "node.fs").length }`,
    );
    expect(off).toEqual({ fsSpans: 0 });

    const on = await runWithCollector(
      /* js */ `
        Bun.otel.configure({ endpoint: "http://127.0.0.1:" + __collectorPort, scheduledDelayMillis: 60_000, instrument: { fs: true } });
        await require("node:fs").promises.readFile(${JSON.stringify(p)});
        await require("node:fs").promises.writeFile(${JSON.stringify(p)} + ".out", "x");
      `,
      `(() => {
        const r = allSpans.find(s => s.name === "fs.readFile");
        const w = allSpans.find(s => s.name === "fs.writeFile");
        return {
          readScope: r?.scope,
          readPath: attr(r, "fs.path")?.stringValue,
          writeScope: w?.scope,
          fsCount: allSpans.filter(s => s.scope === "node.fs").length,
        };
      })()`,
    );
    expect(on).toEqual({
      readScope: "node.fs",
      readPath: p,
      writeScope: "node.fs",
      fsCount: 2,
    });
  });

  test.concurrent("WebSocket server message span (opt-in via instrument.websocket)", async () => {
    const result = await runWithCollector(
      /* js */ `
        Bun.otel.configure({ endpoint: "http://127.0.0.1:" + __collectorPort, scheduledDelayMillis: 60_000, instrument: { websocket: true, fetch: false } });
        let opened, msgCount = 0;
        const openedP = new Promise(r => opened = r);
        let done; const doneP = new Promise(r => done = r);
        using app = Bun.serve({
          port: 0,
          fetch(req, server) { return server.upgrade(req) ? undefined : new Response("no", { status: 400 }); },
          websocket: {
            open(ws) { opened(); },
            message(ws, msg) { if (++msgCount === 2) { ws.close(); done(); } },
          },
        });
        const ws = new WebSocket("ws://127.0.0.1:" + app.port);
        await new Promise(r => { ws.onopen = r; });
        await openedP;
        ws.send("a");
        ws.send("bb");
        await doneP;
        await new Promise(r => { ws.onclose = r; });
      `,
      `(() => {
        const msgs = allSpans.filter(s => s.scope === "bun.websocket" && s.name === "ws message");
        const open = allSpans.find(s => s.scope === "bun.websocket" && s.name === "ws open");
        return {
          messageCount: msgs.length,
          gotOpen: !!open,
          sizes: msgs.map(m => attr(m, "messaging.message.body.size")?.intValue ?? attr(m, "messaging.message.body.size")?.value).sort(),
          kind: msgs[0]?.kind,
        };
      })()`,
    );
    expect(result).toMatchObject({
      messageCount: 2,
      gotOpen: true,
      kind: 5,
    });
  });
});
