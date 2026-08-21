import { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { tempDir } from "harness";
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
    expect(() => db.query("SELECT * FROM missing").all()).toThrow();
    db.close();
    const got = await collect("bun.sqlite");
    expect(got.map(s => [s.name, s.kind, s.attributes["db.query.text"], s.status.code])).toEqual([
      ["CREATE", 2, "CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)", 0],
      ["INSERT", 2, "INSERT INTO t (name) VALUES (?)", 0],
      ["SELECT", 2, "SELECT * FROM t WHERE id > ?", 0],
      ["SELECT", 2, "select count(*) c from t", 0],
      ["SELECT", 2, "SELECT * FROM missing", 2],
    ]);
    expect(got[0].attributes).toMatchObject({
      "db.system.name": "sqlite",
      "db.namespace": "app.db",
      "db.operation.name": "CREATE",
    });
    expect(got[4].attributes["error.type"]).toBe("SQLITE_ERROR");
    expect(got[4].status.message).toContain("no such table");
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
      ["Bun.write", outFile, null],
      ["Bun.file read", outFile, null],
    ]);
    expect(got[2].status.code).toBe(2);
    expect(got.every(s => s.kind === 0)).toBe(true);
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
  test("span covers spawn → exit with argv and exit code", async () => {
    await Bun.spawn([process.execPath, "-e", "1"], { stdio: ["ignore", "ignore", "ignore"] }).exited;
    Bun.spawnSync([process.execPath, "-e", "process.exit(3)"]);
    const exe = path.basename(process.execPath);
    const got = (await collect("bun.child_process")).filter(s => s.name === `spawn ${exe}`);
    expect(got.map(s => [s.name, s.attributes["process.exit.code"], s.status.code])).toEqual([
      [`spawn ${exe}`, 0, 0],
      [`spawn ${exe}`, 3, 2],
    ]);
    expect(got[0].attributes["process.command_args"]).toEqual([process.execPath, "-e", "1"]);
    expect(got[0].attributes["process.pid"]).toEqual(expect.any(Number));
  });
});

describe("net", () => {
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
    // A port nobody listens on.
    using dead = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
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
    const { promise: opened, resolve } = Promise.withResolvers<void>();
    ws.onopen = () => resolve();
    await opened;
    const { promise: replied, resolve: gotReply } = Promise.withResolvers<void>();
    ws.onmessage = () => gotReply();
    ws.send("hi");
    await replied;
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
      attributes: { "websocket.opcode": "text", "messaging.message.body.size": 2, "in.handler": true },
    });
    // linked, not parented, to the upgrade request
    expect(message.parentSpanId).toBeUndefined();
    expect(message.links).toEqual([expect.objectContaining({ traceId: upgrade.traceId, spanId: upgrade.spanId })]);
  });

  test("failed connect", async () => {
    using dead = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    const port = dead.port;
    dead.stop(true);
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
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
    await Bun.dns.lookup("this-host-does-not-exist.invalid").catch(() => {});
    const got = await collect("bun.dns");
    expect(got.map(s => [s.name, s.attributes["dns.question.name"], s.status.code])).toEqual([
      ["dns.lookup", "localhost", 0],
      ["dns.lookup", "this-host-does-not-exist.invalid", 2],
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
