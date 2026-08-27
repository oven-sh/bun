import { Database } from "bun:sqlite";
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const spans: any[] = [];
restore();
// Tests below reconfigure; always start from the permissive config and an empty buffer.
beforeEach(async () => {
  restore();
  await collect();
});
// The pipeline is process-global; leave nothing behind for later files.
afterAll(() => Bun.otel.shutdown());
const tracer = Bun.otel.tracer("test");

async function collect(scope?: string): Promise<any[]> {
  await Bun.sleep(0);
  await Bun.otel.forceFlush();
  const out = spans.splice(0, spans.length).sort((a, b) => a.startTime - b.startTime);
  return scope ? out.filter(s => s.scope.name === scope) : out;
}

describe("bun:sqlite", () => {
  test("one CLIENT span per statement with db semconv", async () => {
    using dir = tempDir("otel-sqlite", {});
    const file = path.join(String(dir), "app.db");
    const db = new Database(file);
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");
    const insert = db.prepare("INSERT INTO t (name) VALUES (?)");
    insert.run("a");
    db.query("SELECT * FROM t WHERE id > ?").all(0);
    db.query("select count(*) c from t").get();
    insert.run("b");
    // .iterate(): one span for the execution, not one per row fetched
    expect([...db.prepare("SELECT name FROM t ORDER BY id").iterate()].length).toBe(2);
    expect(() => db.query("SELECT * FROM missing").all()).toThrow();
    // close(true) finalizes the outstanding prepare() statements so Windows can delete the file.
    db.close(true);
    const got = await collect("bun.sqlite");
    expect(got.map(s => [s.name, s.kind, s.attributes["db.query.text"], s.status.code])).toEqual([
      ["CREATE app.db", 2, "CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)", 0],
      ["INSERT app.db", 2, "INSERT INTO t (name) VALUES (?)", 0],
      ["SELECT app.db", 2, "SELECT * FROM t WHERE id > ?", 0],
      ["SELECT app.db", 2, "select count(*) c from t", 0],
      ["INSERT app.db", 2, "INSERT INTO t (name) VALUES (?)", 0],
      ["SELECT app.db", 2, "SELECT name FROM t ORDER BY id", 0],
      ["SELECT app.db", 2, "SELECT * FROM missing", 2],
    ]);
    expect(got[0].attributes).toMatchObject({
      "db.system.name": "sqlite",
      "db.namespace": "app.db",
      "db.operation.name": "CREATE",
    });
    expect(got[6].attributes["error.type"]).toBe("SQLITE_ERROR");
    expect(got[6].attributes["db.response.status_code"]).toBe("SQLITE_ERROR");
    expect(got[6].events[0]).toMatchObject({ name: "exception", attributes: { "exception.type": "SQLITE_ERROR" } });
    expect(got[6].status.message).toContain("no such table");
  });

  test("attributeValueLengthLimit applies to db.query.text", async () => {
    Bun.otel.start({
      exporters: [{ export: (b: any[]) => spans.push(...b) }],
      instrumentations: { sqlite: "always" },
      limits: { attributeValueLengthLimit: 10 },
    });
    const db = new Database(":memory:");
    db.query("select 1 as a_rather_long_column_name").get();
    db.close();
    const [q] = await collect("bun.sqlite");
    expect(q.attributes["db.query.text"]).toBe("select 1 a");
  });

  test("a statement span carries the tracestate of the request it runs under", async () => {
    Bun.otel.start({
      exporters: [{ export: (b: any[]) => spans.push(...b) }],
      instrumentations: { sqlite: true, http: true },
    });
    const db = new Database(":memory:");
    using server = Bun.serve({
      port: 0,
      fetch() {
        db.query("select 1").get();
        return new Response("ok");
      },
    });
    await (
      await fetch(server.url, {
        headers: {
          traceparent: "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01",
          tracestate: "vendor=abc,other=1",
        },
      })
    ).text();
    db.close();
    const got = await collect();
    const q = got.find(s => s.scope.name === "bun.sqlite");
    const srv = got.find(s => s.scope.name === "bun.http.server");
    expect(srv.traceState).toBe("vendor=abc,other=1");
    expect(q.traceState).toBe("vendor=abc,other=1");
    expect(q.parentSpanId).toBe(srv.spanId);
  });

  test("nested under the active span and captureDbStatement: false", async () => {
    Bun.otel.start({
      exporters: [{ export: (b: any[]) => spans.push(...b) }],
      instrumentations: { sqlite: "always" },
      captureDbStatement: false,
    });
    const db = new Database(":memory:");
    let parentId: string;
    {
      using parent = tracer.startActiveSpan("parent");
      parentId = parent.spanId;
      db.query("select 1").get();
    }
    db.close();
    const [q] = await collect("bun.sqlite");
    expect(q.parentSpanId).toBe(parentId);
    expect(q.attributes["db.query.text"]).toBeUndefined();
    expect(q.attributes["db.namespace"]).toBeUndefined(); // :memory:
  });
});

describe("node:fs / Bun.file / Bun.write", () => {
  test("async, sync, error, Bun.file().text(), Bun.write()", async () => {
    using dir = tempDir("otel-fs", { "in.txt": "hello" });
    const inFile = path.join(String(dir), "in.txt");
    const outFile = path.join(String(dir), "out.txt");
    const missing = path.join(String(dir), "missing");
    await collect(); // drop the spans tempDir() itself produced
    await fs.promises.readFile(inFile);
    fs.readFileSync(inFile, "utf8");
    expect(() => fs.statSync(missing)).toThrow();
    await new Promise<void>((res, rej) => fs.writeFile(outFile, "cb", e => (e ? rej(e) : res())));
    await Bun.write(outFile, "bunwrite");
    expect(await Bun.file(outFile).text()).toBe("bunwrite");
    const got = (await collect("bun.fs")).filter(s => [inFile, outFile, missing].includes(s.attributes["file.path"]));
    expect(got.map(s => [s.name, s.attributes["file.path"], s.attributes["error.type"] ?? null])).toEqual([
      ["fs.readFile", inFile, null],
      ["fs.readFileSync", inFile, null],
      ["fs.statSync", missing, "ENOENT"],
      ["fs.writeFile", outFile, null],
      ["fs.write", outFile, null],
      ["fs.read", outFile, null],
    ]);
    expect(got[2].status.code).toBe(2);
    expect(got.every(s => s.kind === 0)).toBe(true);
  });

  test("a path that is not UTF-8 is exported as a valid protobuf string (U+FFFD), not raw bytes", async () => {
    // proto3 `string` must be UTF-8; one raw 0xff makes a collector reject the whole export request.
    const raw = Buffer.from([0x2f, 0xff, 0xfe, 0x6f, 0x74, 0x65, 0x6c]); // "/\xff\xfeotel"
    let bytes: Uint8Array | undefined;
    Bun.otel.start({
      instrumentations: { fs: "always" },
      exporters: [{ exportProtobuf: (b: Uint8Array) => (bytes = b) }],
    });
    expect(() => fs.statSync(raw)).toThrow();
    await Bun.otel.forceFlush();
    expect(bytes).toBeDefined();
    expect(Buffer.from(bytes!).includes(raw)).toBe(false);
    const [span] = Bun.otel.decode(bytes!).filter((s: any) => s.name === "fs.statSync");
    expect(span.attributes["file.path"]).toBe("/\uFFFD\uFFFDotel");
  });

  test("default policy is nested-only: no fs spans without a parent", async () => {
    Bun.otel.start({ exporters: [{ export: (b: any[]) => spans.push(...b) }] }); // defaults
    fs.readFileSync(import.meta.path);
    expect(await collect("bun.fs")).toEqual([]);
    tracer.startActiveSpan("p", span => {
      fs.readFileSync(import.meta.path);
      span.end();
    });
    expect((await collect("bun.fs")).map(s => s.name)).toEqual(["fs.readFileSync"]);
  });
});

describe("Bun.spawn", () => {
  test("span covers spawn → exit with executable, arg count and exit code (argv itself is not recorded)", async () => {
    await Bun.spawn([bunExe(), "-e", "1"], { stdio: ["ignore", "ignore", "ignore"], env: bunEnv }).exited;
    Bun.spawnSync([bunExe(), "-e", "process.exit(3)"], { env: bunEnv });
    const exe = path.basename(bunExe());
    const got = (await collect("bun.child_process")).filter(s => s.name === `spawn ${exe}`);
    expect(got.map(s => [s.name, s.attributes["process.exit.code"], s.status.code])).toEqual([
      [`spawn ${exe}`, 0, 0],
      [`spawn ${exe}`, 3, 2],
    ]);
    expect(got[0].attributes["process.executable.name"]).toBe(exe);
    expect(got[0].attributes["process.args_count"]).toBe(3);
    expect(got[0].attributes["process.command_args"]).toBeUndefined();
    expect(got[0].attributes["process.pid"]).toEqual(expect.any(Number));
  });
});

describe("net", () => {
  test("a connect attempt destroyed before it opens is not exported (and a later attempt on the wrapper is not 'replaced')", async () => {
    using listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {}, open() {} } });
    const net = require("node:net");
    const s = net.connect(listener.port, "127.0.0.1");
    s.destroy();
    await new Promise<void>(r => s.once("close", r));
    const ok = net.connect(listener.port, "127.0.0.1");
    await new Promise<void>(r => ok.once("connect", r));
    ok.destroy();
    const got = (await collect()).filter(s => s.name === "tcp.connect");
    expect(got.map(s => s.status.code)).toEqual([0]);
  });

  test("tcp.connect span for Bun.connect / node:net, success and failure", async () => {
    using listener = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        data() {},
        open(s) {
          s.end();
        },
      },
    });
    await new Promise<void>((resolve, reject) => {
      const s = net.connect(listener.port, "127.0.0.1", () => {
        s.destroy();
        resolve();
      });
      s.on("error", reject);
    });
    const sock = await Bun.connect({ hostname: "127.0.0.1", port: listener.port, socket: { data() {}, open() {} } });
    sock.end();
    // A port nobody listens on (a raw TCP connect to an accept-and-drop
    // listener would succeed, so this one has to free the port; the file does
    // not run tests concurrently).
    const dead = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    const deadPort = dead.port;
    dead.stop(true);
    await Bun.connect({ hostname: "127.0.0.1", port: deadPort, socket: { data() {} } }).catch(() => {});
    const got = await collect("bun.net");
    expect(
      got.map(s => [s.name, s.kind, s.attributes["server.address"], s.attributes["server.port"], s.status.code]),
    ).toEqual([
      ["tcp.connect", 2, "127.0.0.1", listener.port, 0],
      ["tcp.connect", 2, "127.0.0.1", listener.port, 0],
      ["tcp.connect", 2, "127.0.0.1", deadPort, 2],
    ]);
    expect(got[2].attributes["error.type"]).toEqual(expect.stringMatching(/^E[A-Z]+$/));
    // Failures carry an exception event and a human-readable status message.
    expect(got[2].events[0]).toMatchObject({
      name: "exception",
      attributes: { "exception.type": got[2].attributes["error.type"] },
    });
    expect(got[2].status.message).not.toBe(got[2].attributes["error.type"]);
    // Successful connects report the peer.
    expect(got[0].attributes["network.peer.address"]).toBe("127.0.0.1");
    expect(got[0].attributes["network.peer.port"]).toBe(listener.port);
  });
});

describe("WebSocket", () => {
  test("client connect span; server message spans linked to the upgrade request", async () => {
    using server = Bun.serve({
      port: 0,
      fetch(req, srv) {
        if (srv.upgrade(req)) return;
        return new Response("no");
      },
      websocket: {
        message(ws, m) {
          Bun.otel.activeSpan()?.setAttribute("in.handler", true);
          ws.send("echo:" + m);
        },
      },
    });
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}/chat`);
    const { promise: opened, resolve, reject } = Promise.withResolvers<void>();
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error("ws error"));
    ws.onclose = e => reject(new Error(`ws closed ${e.code}`));
    await opened;
    const { promise: replied, resolve: gotReply, reject: noReply } = Promise.withResolvers<void>();
    ws.onmessage = () => gotReply();
    ws.onerror = () => noReply(new Error("ws error"));
    ws.onclose = e => noReply(new Error(`ws closed ${e.code}`));
    ws.send("hi");
    await replied;
    ws.onclose = null;
    ws.close();
    const got = await collect();
    const connect = got.find(s => s.name === "websocket.connect");
    const upgrade = got.find(s => s.scope.name === "bun.http.server");
    const message = got.find(s => s.name === "websocket.message");
    expect(connect).toMatchObject({
      kind: 2,
      attributes: {
        "server.address": "127.0.0.1",
        "server.port": server.port,
        "url.full": `ws://127.0.0.1:${server.port}/chat`,
      },
    });
    expect(upgrade.attributes["http.response.status_code"]).toBe(101);
    expect(message).toMatchObject({
      kind: 1,
      attributes: { "websocket.message.type": "text", "websocket.message.length": 2, "in.handler": true },
    });
    // linked, not parented, to the upgrade request
    expect(message.parentSpanId).toBeUndefined();
    expect(message.links).toEqual([expect.objectContaining({ traceId: upgrade.traceId, spanId: upgrade.spanId })]);
  });

  test("a message handler still pending when the socket closes is ended then, not leaked", async () => {
    using dir = tempDir("otel-ws-pending", {
      "index.js": `
        const spans = [];
        Bun.otel.start({ exporters: [{ export(b) { spans.push(...b); } }], instrumentations: ["websocket"] });
        const server = Bun.serve({
          port: 0,
          fetch(req, srv) { if (srv.upgrade(req)) return; return new Response("no"); },
          websocket: { message() { return new Promise(() => {}); } },
        });
        for (let i = 0; i < 3; i++) {
          const ws = new WebSocket("ws://127.0.0.1:" + server.port + "/");
          await new Promise(r => (ws.onopen = r));
          ws.send("x");
          await Bun.sleep(20);
          ws.close();
          await new Promise(r => (ws.onclose = r));
        }
        await Bun.sleep(20);
        await Bun.otel.forceFlush();
        const m = spans.filter(s => s.name === "websocket.message");
        console.log(JSON.stringify([m.length, m[0]?.status.code, Bun.otel.stats().spansPending]));
        server.stop(true);
        process.exit(0);
      `,
    });
    await using proc = Bun.spawn({ cmd: [bunExe(), "index.js"], cwd: String(dir), env: bunEnv, stderr: "inherit" });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect(stdout.trim()).toBe(JSON.stringify([3, 2, 0]));
    expect(exitCode).toBe(0);
  });

  test("an async message handler's span covers its promise and records a late rejection", async () => {
    using dir = tempDir("otel-ws-async", {
      "index.js": `
        const { promise, resolve } = Promise.withResolvers();
        process.on("unhandledRejection", e => resolve("unhandled:" + e.message));
        const spans = [];
        Bun.otel.start({ exporters: [{ export(b) { spans.push(...b); } }], instrumentations: ["websocket", "http"] });
        const server = Bun.serve({
          port: 0,
          fetch(req, srv) { if (srv.upgrade(req)) return; return new Response("no"); },
          websocket: { async message() { await Bun.sleep(20); throw new Error("late"); } },
        });
        const ws = new WebSocket("ws://127.0.0.1:" + server.port + "/");
        ws.onopen = () => ws.send("x");
        const how = await Promise.race([promise, Bun.sleep(500).then(() => "no-unhandled")]);
        ws.close();
        await Bun.sleep(10);
        await Bun.otel.forceFlush();
        const m = spans.find(s => s.name === "websocket.message");
        console.log(JSON.stringify([how, m.status.code, m.events[0]?.attributes["exception.message"], (m.endTime - m.startTime) >= 15]));
        server.stop(true);
        process.exit(0);
      `,
    });
    await using proc = Bun.spawn({ cmd: [bunExe(), "index.js"], cwd: String(dir), env: bunEnv, stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // the rejection is still reported as unhandled (once), and the span records it
    expect(stdout.trim()).toBe(JSON.stringify(["unhandled:late", 2, "late", true]));
    expect(exitCode).toBe(0);
  });

  test("a message handler that throws is still reported, even if describing the error throws", async () => {
    // Runs out of process: the thrown error surfaces as an uncaught exception.
    using dir = tempDir("otel-ws-throw", {
      "index.js": `
        const { promise, resolve } = Promise.withResolvers();
        process.on("uncaughtException", e => resolve("uncaught:" + e.message));
        const spans = [];
        Bun.otel.start({ exporters: [{ export(b) { spans.push(...b); } }], instrumentations: ["websocket", "http"] });
        const server = Bun.serve({
          port: 0,
          fetch(req, srv) { if (srv.upgrade(req)) return; return new Response("no"); },
          websocket: {
            message() {
              const e = new Error("boom");
              Object.defineProperty(e, "stack", { get() { throw new Error("stack getter throws"); } });
              throw e;
            },
          },
        });
        const ws = new WebSocket("ws://127.0.0.1:" + server.port + "/");
        ws.onopen = () => ws.send("x");
        const how = await promise;
        ws.close();
        await Bun.otel.forceFlush();
        const m = spans.find(s => s.name === "websocket.message");
        console.log(JSON.stringify([how, m.status.code, m.events[0]?.name, m.events[0]?.attributes["exception.message"]]));
        server.stop(true);
        process.exit(0);
      `,
    });
    await using proc = Bun.spawn({ cmd: [bunExe(), "index.js"], cwd: String(dir), env: bunEnv, stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout.trim()).toBe(JSON.stringify(["uncaught:boom", 2, "exception", "boom"]));
    expect(exitCode).toBe(0);
  });

  test("failed connect", async () => {
    // Accepts and drops the connection before any handshake (held so no
    // concurrent test is handed the port).
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
    const ws = new WebSocket(`ws://127.0.0.1:${dead.port}/`);
    const { promise, resolve } = Promise.withResolvers<void>();
    ws.onerror = () => resolve();
    ws.onclose = () => resolve();
    await promise;
    const [connect] = await collect("bun.websocket");
    expect(connect.status.code).toBe(2);
    expect(connect.attributes["error.type"]).toEqual(expect.any(String));
  });
});

describe("dns", () => {
  test("Bun.dns.lookup span", async () => {
    await Bun.dns.lookup("localhost");
    // a name the resolver rejects locally (label > 63 bytes), no network round trip
    const badName = Buffer.alloc(70, "a").toString() + ".invalid";
    await Bun.dns.lookup(badName).catch(() => {});
    const got = await collect("bun.dns");
    expect(got.map(s => [s.name, s.attributes["dns.question.name"], s.status.code])).toEqual([
      ["dns.lookup", "localhost", 0],
      ["dns.lookup", badName, 2],
    ]);
    expect(got[1].attributes["error.type"]).toMatch(/^DNS_E/);
  });
});

function restore() {
  Bun.otel.start({
    serviceName: "otel-integrations-test",
    exporters: [{ export: (b: any[]) => spans.push(...b) }],
    instrumentations: Object.fromEntries(
      ["http", "fetch", "sql", "sqlite", "redis", "net", "websocket", "fs", "spawn", "dns"].map(k => [k, "always"]),
    ),
  });
}
