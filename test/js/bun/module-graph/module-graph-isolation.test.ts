// Bun.ModuleGraph: graphs are isolated from each other and from the
// host. What one opens is its own: disposing it closes that and nothing else, whoever's code
// happened to be running when it was opened.
import { afterAll, beforeAll, describe, expect, setSystemTime, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir, tls as tlsCertificate } from "harness";
import { AsyncLocalStorage } from "node:async_hooks";
import { EventEmitter } from "node:events";
import http from "node:http";
import http2 from "node:http2";
import { builtinModules } from "node:module";
import { PerformanceObserver } from "node:perf_hooks";
import { join } from "path";

const ModuleGraph = Bun.ModuleGraph;
type Graph = InstanceType<typeof ModuleGraph>;

// What an opener records for the host to look at. `close` undoes it (the host's own copy is closed
// through it at the end of a test).
type State = {
  tag: string;
  ticks: number;
  port: any;
  pid: number;
  settled: string | undefined;
  heard: string[];
  file: string;
  close: (() => void) | undefined;
  // For chains:
  stop: boolean;
  pending: string | undefined;
  arrivedBy: string | undefined;
  wrong: string[];
};

const dir = String(
  tempDir("module-graph-isolation-", {
    // Every opener takes the host's state object: nothing here depends on `globals`.
    "data.txt": "0123456789",
    "entry.js": "export const a = 1;",
    "ticker.mjs": `setInterval(() => state.ticks++, 1);`,
    // Opens one kind of thing in a graph, disposes the graph, and is done: the process has to be too.
    // Runs one retry loop in a graph, disposes the graph, and says whether the loop went on. A loop
    // that starves the host never gets that far: "armed" is then all there is, and the test's
    // timeout on the process is what ends it.
    "retries-then-is-disposed.mjs": `
      import { writeSync } from "node:fs";
      const [name, ports] = [process.argv[2], JSON.parse(process.argv[3])];
      const graph = new Bun.ModuleGraph();
      const app = await graph.import(import.meta.dir + "/app.mjs");
      const state = { ticks: 0 };
      let hostTurns = 0;
      setInterval(() => hostTurns++, 1);
      const hostTurnsPass = async turns => { for (const from = hostTurns; hostTurns < from + turns; ) await new Promise(resolve => setImmediate(resolve)); };
      graph.run(() => app.retryForever(name, state, ports));
      await hostTurnsPass(10);
      writeSync(1, "armed\\n");
      graph.dispose();
      // What the graph had already queued runs once; nothing that starts settles, so the loop takes
      // no step after that.
      await hostTurnsPass(50);
      const before = state.ticks;
      await hostTurnsPass(50);
      const quiet = state.ticks === before;
      writeSync(1, quiet ? "stops\\n" : "keeps running\\n");
      process.exit(0);
    `,
    "opens-then-disposes.mjs": `
      const [kind, state, args] = [process.argv[2], JSON.parse(process.argv[3]), JSON.parse(process.argv[4])];
      const graph = new Bun.ModuleGraph();
      const app = await graph.import(import.meta.dir + "/app.mjs");
      await graph.run(() => app.open[kind](state, ...args));
      graph.dispose();
      console.log("disposed");
      // Does not keep the process running; says so if something else does.
      setTimeout(() => { console.log("and the process is still running"); process.exit(1); }, 3000).unref();
    `,
    // What a disposed graph left in something of the realm's. Each in a process of its own: they count objects.
    "left-behind-tenant.mjs": `
      import { Database } from "bun:sqlite";
      import childProcess from "node:child_process";
      import fs from "node:fs";
      import { PerformanceObserver } from "node:perf_hooks";
      import { DatabaseSync } from "node:sqlite";
      // (No node:sqlite statement: its close() leaves the file open until they are collected, dispose() or not.)
      // Files held open inside \`dir\`, each by an object that would have to be closed or collected to let go.
      export const keepsFilesOpen = async dir => {
        const db = new Database(dir + "/bun.sqlite");
        db.run("create table t (a)");
        const nodeDb = new DatabaseSync(dir + "/node.sqlite");
        nodeDb.exec("create table t (a)");
        const writer = Bun.file(dir + "/written.txt").writer();
        writer.write("x");
        await writer.flush();
        const handle = await fs.promises.open(dir + "/handle.txt", "w");
        const stream = fs.createWriteStream(dir + "/stream.txt");
        await new Promise(resolve => stream.once("open", resolve));
        return { db, statement: db.prepare("select a from t"), nodeDb, writer, handle, stream };
      };
      export const observeHttp = () => new PerformanceObserver(() => {}).observe({ entryTypes: ["http"] });
      // Streams in the middle of their work: each holds a descriptor only it would close.
      export const streams = async (path, count) => {
        const opened = [];
        for (let i = 0; i < count; i++) {
          const read = fs.createReadStream(path, { highWaterMark: 1 });
          read.on("data", () => read.pause());
          const write = fs.createWriteStream(path + ".out-" + i);
          write.write("x");
          opened.push(new Promise(resolve => read.once("data", resolve)), new Promise(resolve => write.once("open", resolve)));
        }
        await Promise.all(opened);
      };
      // Children with piped stdio that say nothing: nobody is reading the pipes to their end.
      export const quietChildren = (bun, count) => { for (let i = 0; i < count; i++) childProcess.spawn(bun, ["-e", "setInterval(() => {}, 1000)"]); };
      // Request bodies that never finish: each upload is streaming for as long as its fetch lives.
      export const uploads = (port, count) => {
        for (let i = 0; i < count; i++) {
          const body = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(1024)); return new Promise(resolve => setTimeout(resolve, 1)); } });
          fetch("http://127.0.0.1:" + port + "/", { method: "POST", body, duplex: "half" }).catch(() => {});
        }
      };
      // An async element handler parked on a timer: dropped with the graph, its promise is collected
      // unsettled, which is when HTMLRewriter gives the rewrite up.
      export const rewrites = say => {
        new HTMLRewriter().on("p", { async element(element) { await new Promise(resolve => setTimeout(resolve, 5)); element.remove(); } })
          .transform(new Response("<p>a</p><p>b</p>")).text().then(() => say("fulfilled"), error => say("rejected: " + error.message));
      };
      // More writes than the pool has threads, so most are still queued when this returns.
      export const opensForWriting = (dir, count) => Promise.all(Array.from({ length: count }, (_, i) => fs.promises.open(dir + "/tenant-" + i, "w")));
      export const queuesWrites = async (dir, count) => {
        const data = Buffer.alloc(4 << 20, "T");
        for (const handle of await opensForWriting(dir, count)) handle.write(data, 0, data.length, 0).catch(() => {});
      };
      // A module loaded through a graph of its own making.
      export const loadsThroughAGraphOfItsOwn = specifier => new Bun.ModuleGraph().import(specifier);
      export const makesAGraph = options => new Bun.ModuleGraph(options);
      // (hostMakesAGraph: a function of the host's, passed in globals.)
      export const hasTheHostMakeAGraph = () => hostMakesAGraph();
      // FileHandles nobody closes and nobody keeps.
      export const forgetsFileHandles = async (path, count) => { for (let i = 0; i < count; i++) await fs.promises.open(path, "r"); };
      // One the host is handed, with a stream over another.
      export const fileHandleAndStream = async path => ({ handle: await fs.promises.open(path, "r"), stream: await new Promise(resolve => { const stream = fs.createReadStream(path, { highWaterMark: 1 }); stream.once("open", () => resolve(stream)); }) });
      export const opens = (path, count) => { for (let i = 0; i < count; i++) fs.promises.open(path, "r").then(handle => handle.close(), () => {}); };
      // unwrapKey("jwk") of bytes that are not a JWK rejects from its first step.
      export async function failingUnwraps(count) {
        const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "unwrapKey"]);
        const iv = new Uint8Array(12);
        const notAJwk = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode("this is not json"));
        let rejected = 0;
        await Promise.all(Array.from({ length: count }, () => crypto.subtle.unwrapKey("jwk", notAJwk, key, { name: "AES-GCM", iv }, { name: "AES-GCM" }, true, ["encrypt"]).catch(() => rejected++)));
        return rejected;
      }
      export const digests = count => {
        const data = new Uint8Array(8 << 20);
        for (let i = 0; i < count; i++) { const held = new FormData(); crypto.subtle.digest("SHA-256", data).then(() => held); }
      };
    `,
    "observer-of-a-disposed-graph.mjs": `
      import http from "node:http";
      import { heapStats } from "bun:jsc";
      const server = http.createServer((request, response) => response.end("ok"));
      await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
      const get = () => new Promise(resolve => http.get({ port: server.address().port, host: "127.0.0.1", agent: false }, response => { response.resume(); response.on("end", resolve); }));
      const graph = new Bun.ModuleGraph();
      const app = await graph.import(import.meta.dir + "/left-behind-tenant.mjs");
      // ("control": the same requests with no observer anywhere.)
      if (process.argv[2] === "observe") graph.run(() => app.observeHttp());
      graph.dispose();
      const objects = () => { Bun.gc(true); const counts = heapStats().objectTypeCounts; return (counts.Object ?? 0) + (counts.Array ?? 0); };
      for (let i = 0; i < 10; i++) await get();
      const before = objects();
      const requests = 100;
      for (let i = 0; i < requests; i++) await get();
      console.log(JSON.stringify({ requests, kept: objects() - before }));
      server.close();
    `,
    "files-of-a-disposed-graph.mjs": `
      import fs from "node:fs";
      const descriptors = () => fs.readdirSync(process.platform === "linux" ? "/proc/self/fd" : "/dev/fd").length;
      const graph = new Bun.ModuleGraph();
      const app = await graph.import(import.meta.dir + "/left-behind-tenant.mjs");
      const before = descriptors();
      graph.run(() => app.opens(import.meta.path, 64));
      graph.dispose();
      // The same work asked for afterwards has finished: the graph's had too.
      await Promise.all(Array.from({ length: 64 }, () => fs.promises.open(import.meta.path, "r").then(handle => handle.close())));
      await new Promise(resolve => setImmediate(resolve));
      console.log(JSON.stringify({ leftOpen: descriptors() - before }));
    `,
    "pipes-of-a-disposed-graph.mjs": `
      import fs from "node:fs";
      const descriptors = () => fs.readdirSync(process.platform === "linux" ? "/proc/self/fd" : "/dev/fd").length;
      const graph = new Bun.ModuleGraph();
      const app = await graph.import(import.meta.dir + "/left-behind-tenant.mjs");
      const before = descriptors();
      graph.run(() => app.quietChildren(process.execPath, 8));
      const open = descriptors() - before;
      graph.dispose();
      // Killed, then reaped from the event loop: their pipes are closed by then at the latest.
      while (descriptors() > before) await new Promise(resolve => setImmediate(resolve));
      console.log(JSON.stringify({ opened: open >= 16, leftOpen: descriptors() - before }));
    `,
    // (The host must not have loaded node:http before the graph does.)
    "first-to-load-node-http-tenant.mjs": `
      import { createRequire } from "node:module";
      // Loaded when first used, inside the graph's context: the module's own top level runs there.
      const load = name => createRequire(import.meta.url)("node:" + name);
      export const get = (name, port) => new Promise(resolve => load(name).get({ host: "127.0.0.1", port, path: "/", rejectUnauthorized: false }, response => response.resume().on("end", resolve)));
      // From a microtask, which still runs once the graph has been disposed. (Its require() throws by
      // then; process.getBuiltinModule() is nobody's in particular.)
      export const loaded = [];
      export const loadLater = name => queueMicrotask(() => { process.getBuiltinModule("node:" + name); loaded.push(name); });
    `,
    "tls-certificate.json": JSON.stringify(tlsCertificate),
    "first-to-load-node-http.mjs": `
      // node:http or node:https, first loaded by a graph that uses it, or by what a disposed graph
      // had queued. Either way the module (its globalAgent) is the realm's: the host's request goes through.
      const [name, how] = [process.argv[2], process.argv[3]];
      const tls = name === "https" ? (await import(import.meta.dir + "/tls-certificate.json", { with: { type: "json" } })).default : undefined;
      using server = Bun.serve({ port: 0, hostname: "127.0.0.1", tls, fetch: () => new Response("ok") });
      const graph = new Bun.ModuleGraph();
      const app = await graph.import(import.meta.dir + "/first-to-load-node-http-tenant.mjs");
      if (how === "used") await graph.run(() => app.get(name, server.port));
      else graph.run(() => app.loadLater(name));
      graph.dispose();
      while (how !== "used" && !app.loaded.includes(name)) await new Promise(resolve => setImmediate(resolve));
      const http = await import("node:" + name);
      const status = await new Promise(resolve => http.get({ host: "127.0.0.1", port: server.port, path: "/", rejectUnauthorized: false }, response => { response.resume(); resolve(response.statusCode); }));
      console.log(JSON.stringify({ status }));
      process.exit(0);
    `,
    "uploads-of-a-disposed-graph.mjs": `
      import { heapStats } from "bun:jsc";
      let arrived = 0;
      using server = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(request) { arrived++; for await (const chunk of request.body) {} return new Response("done"); } });
      // (A write the upload is waiting on is a protected promise.)
      const protectedPromises = () => { Bun.gc(true); return heapStats().protectedObjectTypeCounts.Promise ?? 0; };
      const before = protectedPromises();
      const graph = new Bun.ModuleGraph();
      const app = await graph.import(import.meta.dir + "/left-behind-tenant.mjs");
      graph.run(() => app.uploads(server.port, 16));
      while (arrived < 16) await new Promise(resolve => setImmediate(resolve));
      const streaming = protectedPromises() - before >= 16;
      graph.dispose();
      while (protectedPromises() > before) await new Promise(resolve => setImmediate(resolve));
      console.log(JSON.stringify({ streaming, released: true }));
      process.exit(0);
    `,
    "rewrite-given-up-at-exit.mjs": `
      import { writeSync } from "node:fs";
      const said = [];
      const graph = new Bun.ModuleGraph();
      const app = await graph.import(import.meta.dir + "/left-behind-tenant.mjs");
      graph.run(() => app.rewrites(what => said.push(what)));
      await new Promise(resolve => setTimeout(resolve, 1));
      graph.dispose();
      // Nothing is left for the host to do: the process winds down, collecting on the way.
      process.on("exit", () => writeSync(1, JSON.stringify({ said })));
    `,
    "queued-writes-of-a-disposed-graph.mjs": `
      import fs from "node:fs";
      const dir = fs.mkdtempSync(import.meta.dir + "/queued-writes-");
      const graph = new Bun.ModuleGraph();
      const app = await graph.import(import.meta.dir + "/left-behind-tenant.mjs");
      if (process.argv[2] === "host") {
        // The host writes through handles the graph opened: the descriptors are still the graph's.
        const data = Buffer.alloc(4 << 20, "T");
        for (const handle of await graph.run(() => app.opensForWriting(dir, 64))) handle.write(data, 0, data.length, 0).catch(() => {});
      } else if (process.argv[2] === "host, through Bun.file(fd)") {
        // The same by number: Bun.write() to a descriptor the graph opened.
        const data = Buffer.alloc(4 << 20, "T");
        for (const handle of await graph.run(() => app.opensForWriting(dir, 64))) Bun.write(Bun.file(handle.fd), data).catch(() => {});
      } else await graph.run(() => app.queuesWrites(dir, 64));
      graph.dispose();
      // The host's files are given the descriptor numbers the graph's had.
      const mine = Array.from({ length: 64 }, (_, i) => fs.openSync(dir + "/host-" + i, "w"));
      // The graph's writes are done (or dropped) once the pool has come round to a job queued behind them.
      await fs.promises.readFile(import.meta.path);
      for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve));
      const written = mine.filter(fd => fs.fstatSync(fd).size > 0).length;
      console.log(JSON.stringify({ hostFilesWrittenTo: written }));
      process.exit(0);
    `,
    "not-loaded-yet.ts": Array.from(
      { length: 40 },
      (_, i) => `export function f${i}(a: number): number { return a + ${i}; }`,
    ).join("\n"),
    "parks-in-tla.mjs": `
      parked();
      await gate;
      export const loaded = true;
    `,
    "host-import-parked-at-dispose.mjs": `
      const parked = Promise.withResolvers();
      const graph = new Bun.ModuleGraph({ globals: { gate: new Promise(() => {}), parked: parked.resolve } });
      let settled = "pending";
      graph.import(import.meta.dir + "/parks-in-tla.mjs").then(() => (settled = "fulfilled"), error => (settled = "rejected: " + error.code));
      await parked.promise;
      graph.dispose();
      for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve));
      console.log(JSON.stringify({ settled }));
      process.exit(0);
    `,
    "broadcast-channel-of-a-disposed-graph.mjs": `
      import { AsyncLocalStorage } from "node:async_hooks";
      const heardByTheHost = [];
      const listener = new BroadcastChannel("of-a-disposed-graph");
      const marker = Promise.withResolvers();
      listener.onmessage = event => (event.data === "the host's own" ? marker.resolve() : heardByTheHost.push(event.data));
      const graph = new Bun.ModuleGraph();
      const inGraph = graph.run(() => AsyncLocalStorage.snapshot());
      const outcomes = [];
      const posts = when => {
        try { const channel = new BroadcastChannel("of-a-disposed-graph"); channel.postMessage(when); channel.close(); outcomes.push("said nothing"); }
        catch (error) { outcomes.push("threw " + error.name); }
      };
      graph.dispose();
      // In the turn that disposed (the stop has not closed what is made now), and once it has.
      inGraph(() => posts("in the same turn"));
      for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve));
      inGraph(() => posts("later"));
      // Messages arrive in the order they were posted: the host's own comes after anything the graph got out.
      const mine = new BroadcastChannel("of-a-disposed-graph");
      mine.postMessage("the host's own");
      await marker.promise;
      console.log(JSON.stringify({ outcomes, heardByTheHost }));
      process.exit(0);
    `,
    "ticks-from-its-top-level.mjs": `
      globalThis.evaluatedIn = Bun.ModuleGraph.current === undefined ? "the host's context" : "a graph's context";
      setInterval(() => globalThis.ticks++, 1);
    `,
    "graph-made-by-a-graph.mjs": `
      globalThis.ticks = 0;
      const tenant = new Bun.ModuleGraph();
      const app = await tenant.import(import.meta.dir + "/left-behind-tenant.mjs");
      await tenant.run(() => app.loadsThroughAGraphOfItsOwn(import.meta.dir + "/ticks-from-its-top-level.mjs"));
      while (globalThis.ticks < 3) await new Promise(resolve => setImmediate(resolve));
      tenant.dispose();
      const ticks = globalThis.ticks;
      // Host timers of the same delay, armed after the interval, come due after it would have.
      for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 1));
      console.log(JSON.stringify({ evaluatedIn: globalThis.evaluatedIn, ticksAfterDispose: globalThis.ticks - ticks }));
      // (Exits by itself: the interval does not keep the process running either.)
    `,
    "graph-handed-to-the-host.mjs": `
      const parked = Promise.withResolvers();
      const tenant = new Bun.ModuleGraph();
      const app = await tenant.import(import.meta.dir + "/left-behind-tenant.mjs");
      const inner = tenant.run(() => app.makesAGraph({ globals: { gate: new Promise(() => {}), parked: parked.resolve } }));
      let inFlight = "pending";
      inner.import(import.meta.dir + "/parks-in-tla.mjs").then(() => (inFlight = "fulfilled"), error => (inFlight = "rejected: " + error.code));
      await parked.promise;
      tenant.dispose();
      const afterwards = await inner.import(import.meta.dir + "/not-loaded-yet.ts").then(() => "fulfilled", error => "rejected: " + error.code);
      for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve));
      console.log(JSON.stringify({ inFlight, afterwards }));
      process.exit(0);
    `,
    "throws-later.mjs": `
      setTimeout(() => { throw new Error("thrown from a timer"); }, 1);
      setTimeout(() => { Promise.reject(new Error("rejected and unhandled")); }, 1);
    `,
    "rejects-when-called.mjs": `
      export const rejects = () => void Promise.reject(new Error("rejected by the inner graph's code"));
      export const startsIt = () => void Promise.reject(new Error("the first one"));
    `,
    "on-error-that-causes-an-inner-rejection.mjs": `
      const hostSaw = [];
      process.on("unhandledRejection", error => hostSaw.push(error.message));
      let calls = 0, inner;
      // The tenant's onError causes a rejection in the code of a graph the tenant made without an
      // onError: given back to the same onError it would go round for ever.
      const tenant = new Bun.ModuleGraph({ onError: () => { if (++calls <= 50) inner.rejects(); } });
      const app = await tenant.import(import.meta.dir + "/left-behind-tenant.mjs");
      inner = await tenant.run(() => app.makesAGraph().import(import.meta.dir + "/rejects-when-called.mjs"));
      tenant.run(() => inner.startsIt());
      while (hostSaw.length === 0 && calls <= 50) await new Promise(resolve => setImmediate(resolve));
      for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve));
      console.log(JSON.stringify({ callsOfTheTenantsOnError: calls, hostSaw }));
      process.exit(0);
    `,
    "imports-a-commonjs-module.mjs": `import ran from "./commonjs-that-tells.cjs"; export default ran;`,
    "commonjs-that-tells.cjs": `tell("the CommonJS body ran"); module.exports = true;`,
    "disposed-before-its-commonjs-ran.mjs": `
      // With a plugin registered the transpiler answers in the same turn, so the import is past
      // loading (and waiting to evaluate) when dispose() is called right after it.
      Bun.plugin({ name: "matches-nothing", setup(build) { build.onLoad({ filter: /\\.never$/ }, () => ({ contents: "", loader: "js" })); } });
      const told = [];
      const graph = new Bun.ModuleGraph({ globals: { tell: what => told.push(what) } });
      const imported = graph.import(import.meta.dir + "/imports-a-commonjs-module.mjs").then(() => "fulfilled", error => error.code);
      graph.dispose();
      console.log(JSON.stringify({ imported: await imported, told }));
    `,
    "stops-gracefully.mjs": `
      import fs from "node:fs";
      export const counts = { requests: 0, accepted: 0 };
      // Neither ever answers or closes on its own.
      export const serve = () => Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => (counts.requests++, new Promise(() => {})) });
      export const listen = () => Bun.listen({ port: 0, hostname: "127.0.0.1", socket: { open() { counts.accepted++; }, data() {} } });
      // The documented use of autoClose: false: the script closes the descriptor by number.
      export const readThenCloseByNumber = path => new Promise(resolve => {
        const stream = fs.createReadStream(path, { autoClose: false });
        stream.on("data", () => {}).on("end", () => { const fd = stream.fd; fs.closeSync(fd); resolve(fd); });
      });
    `,
    "isolated/first.test.js": `
      import { test } from "bun:test";
      test("a graph whose fetch is still receiving when this file ends", async () => {
        const graph = new Bun.ModuleGraph();
        const app = await graph.import(import.meta.dir + "/../fetches-bodies.mjs");
        await graph.run(() => app.fetchHeaders(process.env.NEVER_ENDING_URL));
      });
    `,
    "isolated/second.test.js": `
      import { test } from "bun:test";
      import { heapStats } from "bun:jsc";
      test("the realm of the file before is collected", async () => {
        let realms;
        for (let i = 0; i < 100 && realms !== 1; i++) {
          Bun.gc(true);
          await new Promise(resolve => setImmediate(resolve));
          realms = heapStats().objectTypeCounts.GlobalObject;
        }
        console.log("realms: " + realms);
      });
    `,
    "observes-and-connects.mjs": `
      import http2 from "node:http2";
      export const observe = () => new PerformanceObserver(() => {}).observe({ entryTypes: ["mark"] });
      export const connect = port => new Promise(resolve => {
        const session = http2.connect("http://127.0.0.1:" + port);
        session.on("error", () => {});
        session.request({ ":path": "/" }).on("response", resolve).on("error", () => {}).end();
      });
    `,
    "dropped-after-observing-and-connecting.mjs": `
      import http2 from "node:http2";
      import { heapStats } from "bun:jsc";
      const until = async condition => { while (!condition()) await new Promise(resolve => setImmediate(resolve)); };
      const count = name => (Bun.gc(true), heapStats().objectTypeCounts[name] ?? 0);
      // Answers the headers and leaves every stream open.
      const server = http2.createServer().on("stream", stream => stream.respond({ ":status": 200 }));
      await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
      const use = async () => {
        const graph = new Bun.ModuleGraph();
        const app = await graph.import(import.meta.dir + "/observes-and-connects.mjs");
        graph.run(() => app.observe());
        await graph.run(() => app.connect(server.address().port));
        graph.dispose();
      };
      // (One first, so the classes' own cells are there before counting.)
      await use();
      let none;
      await until(() => { const before = none; return (none = count("ModuleGraph") + count("H2FrameParser")) === before; });
      for (let i = 0; i < 3; i++) await use();
      // Nothing of the host's queues a performance entry, and nothing closes the sessions.
      // (No more than before, not as many: the first one's session may have outlived that reading.)
      await until(() => count("ModuleGraph") + count("H2FrameParser") <= none);
      console.log("collected");
      process.exit(0);
    `,
    // Six pages that share a script, so that the builds queue behind one another.
    ...Object.fromEntries(
      Array.from({ length: 6 }, (_, i) => [
        "page-" + i + ".html",
        "<!doctype html><title>page " + i + '</title><script type="module" src="./page-script.ts"></script>',
      ]),
    ),
    "page-script.ts":
      Array.from(
        { length: 400 },
        (_, i) => "export function f" + i + "(a: number): number { return a * " + i + "; }",
      ).join("\n") + "\nconsole.log(f1(2));",
    // For a run whose cwd is this folder: the server's own plugins, which every page's build borrows.
    "serve-plugin/bunfig.toml": '[serve.static]\nplugins = ["./plugin.ts"]\n',
    "serve-plugin/plugin.ts": `
      export default {
        name: "loads the pages' script, a turn later",
        setup(build) {
          build.onLoad({ filter: /page-script\\.ts$/ }, async ({ path }) => {
            await new Promise(resolve => setImmediate(resolve));
            return { contents: await Bun.file(path).text(), loader: "ts" };
          });
        },
      };
    `,
    "serves-html-routes.mjs": `
      import page0 from "./page-0.html";
      import page1 from "./page-1.html";
      import page2 from "./page-2.html";
      import page3 from "./page-3.html";
      import page4 from "./page-4.html";
      import page5 from "./page-5.html";
      const pages = [page0, page1, page2, page3, page4, page5];
      export const paths = pages.map((_, i) => "/" + i);
      export const serve = () => Bun.serve({ port: 0, hostname: "127.0.0.1", development: false, routes: Object.fromEntries(pages.map((page, i) => ["/" + i, page])) });
    `,
    "disposed-while-building-pages.mjs": `
      import { heapStats } from "bun:jsc";
      const until = async condition => { while (!condition()) await new Promise(resolve => setImmediate(resolve)); };
      const servers = () => { Bun.gc(true); const counts = heapStats().objectTypeCounts; return (counts.HTTPServer ?? 0) + (counts.DebugHTTPServer ?? 0); };
      const use = async () => {
        const graph = new Bun.ModuleGraph();
        const app = await graph.import(import.meta.dir + "/serves-html-routes.mjs");
        const server = graph.run(() => app.serve());
        // A request for a page starts its build, which holds a pending request on the server until it is
        // done. That is a later turn's business: the build seen here is still going when dispose() runs.
        for (const path of app.paths)
          Bun.connect({ hostname: "127.0.0.1", port: server.port, socket: { open: socket => void socket.write("GET " + path + " HTTP/1.1\\r\\nHost: x\\r\\n\\r\\n"), data() {}, close() {}, error() {} } }).catch(() => {});
        await until(() => server.pendingRequests >= 1);
        graph.dispose();
      };
      // (One first, so the class's own cells are there before counting.)
      await use();
      let none;
      await until(() => { const before = none; return (none = servers()) === before; });
      for (let i = 0; i < 3; i++) await use();
      // (No more than before, not as many: the first one may have outlived that reading.)
      let turns = 0;
      await until(() => servers() <= none || ++turns === 2000);
      console.log(servers() <= none ? "collected" : "kept " + (servers() - none));
      process.exit(0);
    `,
    "makes-modules.cjs": `
      const Module = require("node:module");
      const made = name => Object.assign(new Module(__dirname + "/" + name), { filename: __dirname + "/" + name, paths: [] });
      exports.compiled = () => { const module = made("made.cjs"); module._compile("module.exports = typeof tag === 'undefined' ? 'no globals' : tag;", module.filename); return module.exports; };
      exports.required = () => Module.prototype.require.call(made("requires.cjs"), __dirname + "/says-its-tag.cjs");
    `,
    "says-its-tag.cjs": `module.exports = typeof tag === "undefined" ? "no globals" : tag;`,
    "modules-made-by-a-graph.mjs": `
      const graph = new Bun.ModuleGraph({ globals: { tag: "the graph's" } });
      const app = (await graph.import(import.meta.dir + "/makes-modules.cjs")).default;
      console.log(JSON.stringify({ compiled: app.compiled(), required: app.required(), inTheHostsCache: Object.keys(require.cache).some(key => key.endsWith("says-its-tag.cjs")) }));
      process.exit(0);
    `,
    "builds-with-a-plugin.mjs": `
      export const loads = [];
      // Every module imports the next one, and each import goes to the plugin and back.
      export const build = entry => void Bun.build({
        entrypoints: [entry],
        plugins: [{
          name: "chain",
          setup(build) {
            build.onResolve({ filter: /^chain:/ }, args => ({ path: args.path.slice(6), namespace: "chain" }));
            build.onLoad({ filter: /.*/, namespace: "chain" }, args => {
              loads.push(args.path);
              const next = Number(args.path) + 1;
              return { loader: "js", contents: next < 200 ? 'import "chain:' + next + '";' : "" };
            });
          },
        }],
      }).catch(() => {});
    `,
    "chain-entry.js": `import "chain:0";`,
    "disposed-while-building.mjs": `
      const until = async condition => { while (!condition()) await new Promise(resolve => setImmediate(resolve)); };
      const graph = new Bun.ModuleGraph();
      const app = await graph.import(import.meta.dir + "/builds-with-a-plugin.mjs");
      graph.run(() => app.build(import.meta.dir + "/chain-entry.js"));
      await until(() => app.loads.length > 0);
      graph.dispose();
      const atDispose = app.loads.length;
      for (let turn = 0; turn < 200; turn++) await new Promise(resolve => setImmediate(resolve));
      console.log(JSON.stringify({ stoppedShort: atDispose < 200, calledAfterDispose: app.loads.length - atDispose }));
      process.exit(0);
    `,
    "waits-in-a-plugin.mjs": `
      export const waiting = [];
      // The plugin answers after a timer of its own, which goes with its graph.
      export const build = entry => void Bun.build({
        entrypoints: [entry],
        plugins: [{
          name: "slow",
          setup(build) {
            build.onResolve({ filter: /^chain:/ }, args => ({ path: args.path.slice(6), namespace: "chain" }));
            build.onLoad({ filter: /.*/, namespace: "chain" }, async args => {
              waiting.push(args.path);
              await new Promise(resolve => setTimeout(resolve, 60_000));
              return { loader: "js", contents: "" };
            });
          },
        }],
      }).catch(() => {});
    `,
    "disposed-while-a-plugin-waits.mjs": `
      const graph = new Bun.ModuleGraph();
      const app = await graph.import(import.meta.dir + "/waits-in-a-plugin.mjs");
      graph.run(() => app.build(import.meta.dir + "/chain-entry.js"));
      while (app.waiting.length === 0) await new Promise(resolve => setImmediate(resolve));
      graph.dispose();
      // Not process.exit(): a build still waiting for the plugin's answer would keep this process here.
      console.log("idle");
    `,
    "uploads-to-s3.mjs": `
      const client = endpoint => new Bun.S3Client({ accessKeyId: "a", secretAccessKey: "b", bucket: "bucket", endpoint });
      export const chunks = { pulled: 0 };
      // A body that never ends: a chunk now, the next one never.
      const neverEnding = () => new ReadableStream({ pull(controller) { chunks.pulled++; controller.enqueue(new Uint8Array(1 << 16)); return new Promise(() => {}); } });
      export const streamUp = endpoint => void client(endpoint).file("key").write(new Response(neverEnding())).catch(() => {});
      export const writerLeftOpen = endpoint => { client(endpoint).file("key").writer().write("some of it"); chunks.pulled++; };
    `,
    "disposed-while-uploading.mjs": `
      // (Nothing is ever sent: neither upload has a part's worth to send yet.)
      const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("", { status: 500 }) });
      const until = async condition => { while (!condition()) await new Promise(resolve => setImmediate(resolve)); };
      for (const how of ["streamUp", "writerLeftOpen"]) {
        const graph = new Bun.ModuleGraph();
        const app = await graph.import(import.meta.dir + "/uploads-to-s3.mjs");
        graph.run(() => app[how](server.url.href));
        await until(() => app.chunks.pulled > 0);
        graph.dispose();
      }
      server.stop(true);
      // Not process.exit(): an upload that still held the event loop would keep this process here.
      console.log("idle");
    `,
    "subscribes-to-redis.mjs": `
      export let subscribed = false;
      export const subscribe = url => new Bun.RedisClient(url).subscribe("channel", () => {}).then(() => { subscribed = true; });
    `,
    "subscribed-then-gone.mjs": `
      // Speaks enough RESP3 to accept a subscriber, and never publishes.
      const server = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        socket: {
          data(socket, data) {
            for (const command of String(data).split(/(?=\\*\\d+\\r\\n)/)) {
              if (/HELLO/i.test(command)) socket.write("%2\\r\\n$6\\r\\nserver\\r\\n$5\\r\\nredis\\r\\n$5\\r\\nproto\\r\\n:3\\r\\n");
              else if (/SUBSCRIBE/i.test(command)) socket.write(">3\\r\\n$9\\r\\nsubscribe\\r\\n$7\\r\\nchannel\\r\\n:1\\r\\n");
            }
          },
        },
      });
      const url = "redis://127.0.0.1:" + server.port;
      if (process.argv[2] === "disposed") {
        const graph = new Bun.ModuleGraph();
        const app = await graph.import(import.meta.dir + "/subscribes-to-redis.mjs");
        await graph.run(() => app.subscribe(url));
        graph.dispose();
      } else {
        const client = new Bun.RedisClient(url);
        await client.subscribe("channel", () => {});
        client.close();
      }
      server.stop(true);
      // Not process.exit(): a subscription that still held the event loop would keep this process here.
      console.log("idle");
    `,
    "leaves-things-half-done.mjs": `
      import { Duplex } from "node:stream";
      import tls from "node:tls";
      export const heard = [];
      // A write that can never drain: nobody reads the other end.
      export const writeAndEnd = (path, data) => { const writer = Bun.file(path).writer(); writer.write(data); writer.end(); };
      // A child that ignores being asked to stop.
      export const spawnStubborn = signal => {
        const child = Bun.spawn({ cmd: ["sh", "-c", "trap '' TERM; sleep 30 & wait"], signal, stdio: ["ignore", "ignore", "ignore"] });
        child.exited.then(() => heard.push("exited"), () => heard.push("exited"));
        return child.pid;
      };
      // TLS over a stream of the script's own: every byte TLS wants sent is a call to write().
      export const writes = [];
      export const tlsOverDuplex = () => {
        const socket = new Duplex({ read() {}, write(chunk, encoding, callback) { writes.push(chunk.length); callback(); } });
        tls.connect({ socket, rejectUnauthorized: false }).on("error", () => heard.push("error"));
      };
    `,
    "disposed-with-things-half-done.mjs": `
      import fs from "node:fs";
      import { heapStats } from "bun:jsc";
      const until = async condition => { while (!condition()) await new Promise(resolve => setImmediate(resolve)); };
      const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
      const out = {};
      // File sinks with a write parked on a pipe nobody reads.
      const fifo = import.meta.dir + "/fifo-" + process.pid;
      Bun.spawnSync({ cmd: ["mkfifo", fifo] });
      const readEnd = fs.openSync(fifo, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
      // (The class's own cells count as file sinks too: what is there once one of the host's has come and gone.)
      const fileSinks = () => (Bun.gc(true), heapStats().objectTypeCounts.FileSink ?? 0);
      await Bun.file(import.meta.dir + "/scratch-" + process.pid).writer().end();
      let none = fileSinks();
      await until(() => { const before = none; return (none = fileSinks()) === before; });
      for (let i = 0; i < 10; i++) {
        const graph = new Bun.ModuleGraph();
        const app = await graph.import(import.meta.dir + "/leaves-things-half-done.mjs");
        graph.run(() => app.writeAndEnd(fifo, Buffer.alloc(1 << 20, "x")));
        graph.dispose();
      }
      // (No more than before, not as many: the host's own may have outlived that reading.)
      await until(() => fileSinks() <= none);
      out.fileSinks = Math.max(0, fileSinks() - none);
      fs.closeSync(readEnd);
      fs.rmSync(fifo);
      fs.rmSync(import.meta.dir + "/scratch-" + process.pid);
      // A child that ignores SIGTERM, whose own AbortSignal fired before the graph went.
      {
        const graph = new Bun.ModuleGraph();
        const app = await graph.import(import.meta.dir + "/leaves-things-half-done.mjs");
        const controller = new AbortController();
        const pid = graph.run(() => app.spawnStubborn(controller.signal));
        controller.abort();
        graph.dispose();
        await until(() => !alive(pid));
        out.childHeard = app.heard;
      }
      // TLS over the script's own stream, disposed before the handshake was started.
      {
        const graph = new Bun.ModuleGraph();
        const app = await graph.import(import.meta.dir + "/leaves-things-half-done.mjs");
        graph.run(() => app.tlsOverDuplex());
        graph.dispose();
        for (let turn = 0; turn < 10; turn++) await new Promise(resolve => setImmediate(resolve));
        out.tls = { writes: app.writes, heard: app.heard };
      }
      console.log(JSON.stringify(out));
      process.exit(0);
    `,
    "wraps-commonjs-its-own-way.cjs": `
      const Module = require("node:module");
      // A wrapper that is not at the top level: the module function closes over another function's variable.
      Module.wrapper = ["(function () { var outer = 'of the wrapper'; return function (exports, require, module, __filename, __dirname) {", "\\n}; })()"];
      require.extensions[".wrapped"] = (module, filename) => module._compile("module.exports = () => [outer, typeof tag];", filename);
      module.exports = require("./payload.wrapped");
    `,
    "payload.wrapped": "",
    "custom-commonjs-wrapper.mjs": `
      const graph = new Bun.ModuleGraph({ globals: { tag: "of the graph" } });
      const read = (await graph.import(import.meta.dir + "/wraps-commonjs-its-own-way.cjs")).default;
      console.log(JSON.stringify(read()));
      process.exit(0);
    `,
    "streams-over-file-handles.mjs": `
      import fs from "node:fs";
      export const open = async (readFrom, writeTo) => {
        const [reading, writing] = [await fs.promises.open(readFrom, "r"), await fs.promises.open(writeTo, "w")];
        return { reader: reading.createReadStream(), writer: writing.createWriteStream() };
      };
      // From a microtask, which still runs once the graph has been disposed.
      export const useLater = ({ reader, writer }, told) => queueMicrotask(() => {
        reader.on("data", chunk => { told.read = "read " + chunk; }).on("error", error => { told.read = error.code; });
        writer.on("error", () => {}).write("the graph\x27s", error => { told.wrote = error ? error.code : "wrote"; });
      });
    `,
    "serves-who.mjs": `
      export const serve = who => Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response(who) });
    `,
    "taken-over-under-hot.mjs": `
      // Under --hot a Bun.serve() with the hostname and port of one that is up takes that server over.
      const [first, second] = [new Bun.ModuleGraph(), new Bun.ModuleGraph()];
      const [appOfFirst, appOfSecond] = [await first.import(import.meta.dir + "/serves-who.mjs"), await second.import(import.meta.dir + "/serves-who.mjs")];
      const server = first.run(() => appOfFirst.serve("the first"));
      const sameServer = second.run(() => appOfSecond.serve("the second")) === server;
      const ask = () => fetch(server.url).then(response => response.text(), () => "nobody");
      const answers = [await ask()];
      first.dispose();
      answers.push(await ask());
      second.dispose();
      answers.push(await ask());
      console.log(JSON.stringify({ sameServer, answers }));
      process.exit(0);
    `,
    "dials-the-host.mjs": `
      import net from "node:net";
      import http from "node:http";
      // From a microtask, which still runs once the graph has been disposed.
      export const dialLater = port => queueMicrotask(() => {
        net.connect(port, "127.0.0.1").on("error", () => {});
        http.get({ host: "127.0.0.1", port, path: "/" }).on("error", () => {});
      });
    `,
    "dials-after-it-was-disposed.mjs": `
      let arrived = 0;
      const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { open() { arrived++; }, data() {} } });
      const graph = new Bun.ModuleGraph();
      const app = await graph.import(import.meta.dir + "/dials-the-host.mjs");
      graph.run(() => app.dialLater(server.port));
      graph.dispose();
      // A dial of the host's own, made afterwards, has arrived: the graph's would have too.
      await Bun.connect({ hostname: "127.0.0.1", port: server.port, socket: { open(socket) { socket.end(); }, data() {} } });
      for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve));
      console.log(JSON.stringify({ arrivedFromTheGraph: arrived - 1 }));
      process.exit(0);
    `,
    "requests-without-an-agent.mjs": `
      import http from "node:http";
      export const get = port => new Promise((resolve, reject) => http.get({ host: "127.0.0.1", port, path: "/" }, response => { response.resume(); resolve(response.statusCode); }).on("error", reject));
    `,
    "host-replaced-the-global-agent.mjs": `
      import http from "node:http";
      // As a proxy agent is: not constructed the way node's own Agent is.
      class AgentOfTheHosts extends http.Agent {
        constructor(where, options) {
          if (typeof where !== "string") throw new TypeError("an AgentOfTheHosts is made with where it goes through");
          super(options);
        }
      }
      http.globalAgent = new AgentOfTheHosts("somewhere", { keepAlive: true });
      using server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("ok") });
      const graph = new Bun.ModuleGraph();
      const app = await graph.import(import.meta.dir + "/requests-without-an-agent.mjs");
      const status = await graph.run(() => app.get(server.port)).catch(error => String(error));
      graph.dispose();
      console.log(JSON.stringify({ status }));
      process.exit(0);
    `,
    "spawns-and-feeds-a-child.mjs": `
      import childProcess from "node:child_process";
      // What a logger that pipes to a child does; from a microtask, which still runs once the graph has been disposed.
      export const later = () => queueMicrotask(() => {
        const child = childProcess.spawn("cat");
        child.on("error", () => {});
        child.stdin.write("x");
        child.stdin.end();
        child.kill();
        child.unref();
        childProcess.spawn("/does/not/exist/" + import.meta.file);
        // fork() always gives a channel.
        childProcess.fork(import.meta.path).send({ hello: 1 });
      });
    `,
    "spawns-after-it-was-disposed.mjs": `
      // No onError, and no handler of the host's: an error in the graph's leftover code would end this process.
      const graph = new Bun.ModuleGraph();
      const app = await graph.import(import.meta.dir + "/spawns-and-feeds-a-child.mjs");
      graph.run(() => app.later());
      graph.dispose();
      for (let i = 0; i < 20; i++) await new Promise(resolve => setImmediate(resolve));
      console.log(JSON.stringify({ hostStillRuns: true }));
    `,
    "listens-and-reads-its-address.mjs": `
      import http from "node:http";
      import net from "node:net";
      export const heard = [];
      // What every server does: the 'listening' callback reads the port it was given.
      export const listen = () => {
        for (const [name, server] of [["http", http.createServer(() => {})], ["net", net.createServer(() => {})]])
          server.listen(0, "127.0.0.1", () => heard.push(name + " " + typeof server.address().port));
      };
    `,
    "disposed-in-the-turn-it-listens.mjs": `
      // No onError, and no handler of the host's: an error in the graph's leftover code would end this process.
      const graph = new Bun.ModuleGraph();
      const app = await graph.import(import.meta.dir + "/listens-and-reads-its-address.mjs");
      graph.run(() => app.listen());
      graph.dispose();
      for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve));
      console.log(JSON.stringify({ heard: app.heard }));
    `,
    "its-own-streams-after-it-was-disposed.mjs": `
      const [data, scratch] = ["/data.txt", "/scratch-own-" + process.pid].map(name => import.meta.dir + name);
      const graph = new Bun.ModuleGraph();
      const app = await graph.import(import.meta.dir + "/streams-over-file-handles.mjs");
      const streams = await graph.run(() => app.open(data, scratch));
      const told = {};
      graph.run(() => app.useLater(streams, told));
      graph.dispose();
      // Turns enough for a stream to have reported (the host, asking the same of such streams, is
      // told EBADF within one: "streams over its FileHandles that the host still holds").
      for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve));
      // The write that found the descriptor gone is not in flight: the host can still destroy the stream.
      const closed = await new Promise(resolve => streams.writer.on("error", () => {}).on("close", () => resolve(true)).destroy());
      console.log(JSON.stringify({ told, closed }));
      (await import("node:fs")).rmSync(scratch);
      process.exit(0);
    `,
    "host-holds-streams-over-file-handles.mjs": `
      import fs from "node:fs";
      const [data, scratch, hosts] = ["/data.txt", "/scratch-" + process.pid, "/hosts-" + process.pid].map(name => import.meta.dir + name);
      fs.writeFileSync(hosts, "the host\x27s");
      const graph = new Bun.ModuleGraph();
      const app = await graph.import(import.meta.dir + "/streams-over-file-handles.mjs");
      const { reader, writer } = await graph.run(() => app.open(data, scratch));
      const theirs = [reader.fd, writer.fd];
      graph.dispose();
      await new Promise(resolve => setImmediate(resolve));
      // The host opens its own file until it has been handed both numbers.
      const mine = [];
      for (let i = 0; i < 64 && !theirs.every(fd => mine.includes(fd)); i++) mine.push(fs.openSync(hosts, "r+"));
      const read = new Promise(resolve => reader.on("data", chunk => resolve("read " + chunk)).on("error", error => resolve(error.code)));
      const wrote = new Promise(resolve => writer.on("error", error => resolve(error.code)).write("the graph\x27s", error => resolve(error ? error.code : "wrote")));
      console.log(JSON.stringify({ sameNumbers: theirs.every(fd => mine.includes(fd)), read: await read, wrote: await wrote, hosts: fs.readFileSync(hosts, "utf8") }));
      fs.rmSync(hosts); fs.rmSync(scratch);
      process.exit(0);
    `,
    "disposed-after-a-graceful-stop.mjs": `
      const until = async condition => { while (!condition()) await new Promise(resolve => setImmediate(resolve)); };
      const graph = new Bun.ModuleGraph();
      const app = await graph.import(import.meta.dir + "/stops-gracefully.mjs");
      const server = graph.run(() => app.serve());
      const request = fetch(server.url).then(() => "answered", error => error.code);
      const listener = graph.run(() => app.listen());
      const closed = Promise.withResolvers();
      await Bun.connect({ hostname: "127.0.0.1", port: listener.port, socket: { open() {}, data() {}, close() { closed.resolve("closed"); } } });
      await until(() => app.counts.requests === 1 && app.counts.accepted === 1);
      // Graceful: both stop listening and leave what is connected alone.
      graph.run(() => (server.stop(), listener.stop()));
      graph.dispose();
      console.log(JSON.stringify({ request: await request, client: await closed.promise }));
      process.exit(0);
    `,
    "closes-a-descriptor-by-number.mjs": `
      import fs from "node:fs";
      const data = import.meta.dir + "/data.txt";
      const graph = new Bun.ModuleGraph();
      const app = await graph.import(import.meta.dir + "/stops-gracefully.mjs");
      const theirs = await graph.run(() => app.readThenCloseByNumber(data));
      // The host opens files until it is handed the number the graph's script closed.
      let mine;
      for (let i = 0; i < 64 && mine !== theirs; i++) mine = fs.openSync(data, "r");
      graph.dispose();
      await new Promise(resolve => setImmediate(resolve));
      let read;
      try { read = fs.readSync(mine, Buffer.alloc(4), 0, 4, 0); } catch (error) { read = error.code; }
      console.log(JSON.stringify({ sameNumber: mine === theirs, read }));
      process.exit(0);
    `,
    "fetches-bodies.mjs": `
      export let response;
      export let bodiesAwaited = 0;
      export const fetchHeaders = url => fetch(url).then(r => { response = r; });
      export const awaitBody = url => fetch(url).then(r => { bodiesAwaited++; return r.text(); });
    `,
    "response-bodies-of-disposed-graphs.mjs": `
      import { heapStats } from "bun:jsc";
      // A body that never ends: a chunk per pull, the next one when the host says so.
      let release = () => {};
      const server = Bun.serve({ port: 0, fetch: request => new URL(request.url).pathname === "/turn" ? new Response("turn") : new Response(new ReadableStream({ async pull(controller) { controller.enqueue(new Uint8Array(1024)); await new Promise(resolve => (release = resolve)); } })) });
      const until = async condition => { while (!condition()) await new Promise(resolve => setImmediate(resolve)); };
      const hostTurn = async () => void (await (await fetch(server.url.href + "turn")).text());
      // The host reads the body of a Response a graph was given, after the graph is gone.
      const graph = new Bun.ModuleGraph();
      const app = await graph.import(import.meta.dir + "/fetches-bodies.mjs");
      await graph.run(() => app.fetchHeaders(server.url.href));
      graph.dispose();
      await hostTurn();
      const text = app.response.text();
      await hostTurn();
      // Graphs disposed while their script awaits a body.
      for (let i = 0; i < 20; i++) {
        const tenant = new Bun.ModuleGraph();
        const its = await tenant.import(import.meta.dir + "/fetches-bodies.mjs");
        tenant.run(() => void its.awaitBody(server.url.href));
        await until(() => its.bodiesAwaited === 1);
        tenant.dispose();
      }
      await hostTurn();
      Bun.gc(true);
      console.log(JSON.stringify({ text: Bun.peek.status(text), protectedPromises: heapStats().protectedObjectTypeCounts.Promise ?? 0 }));
      process.exit(0);
    `,
    "errors-of-a-graph-made-by-a-graph.mjs": `
      const hostSaw = [], tenantSaw = [];
      process.on("uncaughtException", error => hostSaw.push(error.message));
      process.on("unhandledRejection", error => hostSaw.push(error.message));
      const tenant = new Bun.ModuleGraph({ globals: { hostMakesAGraph: () => new Bun.ModuleGraph() }, onError: error => tenantSaw.push(error.message) });
      const app = await tenant.import(import.meta.dir + "/left-behind-tenant.mjs");
      // A graph made in the tenant's context that was given no onError of its own: by the tenant's
      // code, or by a function of the host's that the tenant called.
      const inner = tenant.run(() => (process.argv[2] === "by a host function it called" ? app.hasTheHostMakeAGraph() : app.makesAGraph()));
      await inner.import(import.meta.dir + "/throws-later.mjs");
      while (hostSaw.length + tenantSaw.length < 2) await new Promise(resolve => setImmediate(resolve));
      console.log(JSON.stringify({ hostSaw, tenantSaw: tenantSaw.sort() }));
      process.exit(0);
    `,
    "open-files-of-a-disposed-graph.mjs": `
      import fs from "node:fs";
      const descriptors = () => (process.platform === "win32" ? 0 : fs.readdirSync(process.platform === "linux" ? "/proc/self/fd" : "/dev/fd").length);
      const dir = fs.mkdtempSync(import.meta.dir + "/open-files-");
      const graph = new Bun.ModuleGraph();
      const app = await graph.import(import.meta.dir + "/left-behind-tenant.mjs");
      const before = descriptors();
      // Kept by the host, so no collection lets go of them.
      const kept = await graph.run(() => app.keepsFilesOpen(dir));
      const open = descriptors() - before;
      graph.dispose();
      // (A writer with a write under way closes when that write returns, a few turns later.)
      while (descriptors() > before) await new Promise(resolve => setImmediate(resolve));
      // On Windows an open file pins its directory: the rename works once every one of them is closed.
      for (;;) {
        try {
          fs.renameSync(dir, dir + "-moved");
          break;
        } catch (error) {
          if (!["EPERM", "EBUSY", "EACCES"].includes(error.code)) throw error;
          await new Promise(resolve => setImmediate(resolve));
        }
      }
      const message = fn => { try { fn(); return "returned"; } catch (error) { return error.message; } };
      console.log(JSON.stringify({
        open: process.platform === "win32" ? 5 : open,
        hostUses: [message(() => kept.db.run("select 1")), message(() => kept.statement.get()), message(() => kept.nodeDb.exec("select 1"))],
      }));
    `,
    "streams-of-a-disposed-graph.mjs": `
      import fs from "node:fs";
      const descriptors = () => fs.readdirSync(process.platform === "linux" ? "/proc/self/fd" : "/dev/fd").length;
      const graph = new Bun.ModuleGraph();
      const app = await graph.import(import.meta.dir + "/left-behind-tenant.mjs");
      const before = descriptors();
      await graph.run(() => app.streams(import.meta.path, 16));
      const open = descriptors() - before;
      graph.dispose();
      // (One with a read or write on the thread pool is closed when that comes back.)
      while (descriptors() > before) await new Promise(resolve => setImmediate(resolve));
      console.log(JSON.stringify({ open, leftOpen: descriptors() - before }));
    `,
    "forgotten-file-handles.mjs": `
      import fs from "node:fs";
      const descriptors = () => fs.readdirSync(process.platform === "linux" ? "/proc/self/fd" : "/dev/fd").length;
      const heard = { host: [], graph: [] };
      process.on("uncaughtException", error => heard.host.push(error.code));
      const graph = new Bun.ModuleGraph({ onError: error => heard.graph.push(error.code) });
      const app = await graph.import(import.meta.dir + "/left-behind-tenant.mjs");
      const before = descriptors();
      await graph.run(() => app.forgetsFileHandles(import.meta.path, 8));
      const open = descriptors() - before;
      if (process.argv[2] === "disposed") graph.dispose();
      const leftOpenByDispose = descriptors() - before;
      // The host forgets one as well: node:fs reporting it says the collection that took the graph's has run.
      await (async () => void (await fs.promises.open(import.meta.path, "r")))();
      const expected = process.argv[2] === "disposed" ? 0 : 8;
      while (heard.host.length < 1 || heard.graph.length < expected) {
        Bun.gc(true);
        await new Promise(resolve => setImmediate(resolve));
      }
      for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve));
      console.log(JSON.stringify({ open, leftOpenByDispose, leftOpen: descriptors() - before, ...heard }));
    `,
    "file-handle-the-host-holds.mjs": `
      import fs from "node:fs";
      const graph = new Bun.ModuleGraph();
      const app = await graph.import(import.meta.dir + "/left-behind-tenant.mjs");
      const { handle, stream } = await graph.run(() => app.fileHandleAndStream(import.meta.path));
      graph.dispose();
      // The numbers are given to the next files opened: what the graph's objects do now must not reach them.
      const mine = [fs.openSync(import.meta.path, "r"), fs.openSync(import.meta.path, "r")];
      const read = await handle.read(Buffer.alloc(1), 0, 1, 0).then(() => "read", error => error.code);
      const streamed = await new Promise(resolve => {
        let saw = "nothing";
        stream.on("error", error => { saw = error.code; });
        stream.on("data", () => { saw = "data"; stream.destroy(); });
        stream.on("close", () => resolve(saw));
      });
      await handle.close();
      const stillMine = mine.map(fd => { try { return fs.readSync(fd, Buffer.alloc(1), 0, 1, 0); } catch (error) { return error.code; } });
      console.log(JSON.stringify({ fd: handle.fd, read, streamed, stillMine }));
    `,
    "subtle-after-a-disposed-graph.mjs": `
      const graph = new Bun.ModuleGraph();
      const app = await graph.import(import.meta.dir + "/left-behind-tenant.mjs");
      const rejectedInTheGraph = await graph.run(() => app.failingUnwraps(200));
      graph.dispose();
      // The host's own operations afterwards: many more than the graph's, so their promises reuse those addresses.
      const data = new Uint8Array(64);
      const digests = await Promise.all(Array.from({ length: 2000 }, () => crypto.subtle.digest("SHA-256", data)));
      console.log(JSON.stringify({ rejectedInTheGraph, settledInTheHost: digests.length }));
    `,
    "subtle-of-a-disposed-graph.mjs": `
      import { heapStats } from "bun:jsc";
      const count = () => heapStats().objectTypeCounts.FormData;
      const keep = new FormData(), baseline = count();
      const graph = new Bun.ModuleGraph();
      const app = await graph.import(import.meta.dir + "/left-behind-tenant.mjs");
      graph.run(() => app.digests(20));
      const started = count() - baseline;
      graph.dispose();
      // The same work asked for afterwards has finished: the graph's had too.
      await crypto.subtle.digest("SHA-256", new Uint8Array(8 << 20));
      let kept = started;
      for (let turn = 0; turn < 200 && kept !== 0; turn++) {
        await new Promise(resolve => setImmediate(resolve));
        Bun.gc(true);
        kept = count() - baseline;
      }
      console.log(JSON.stringify({ started, kept }), keep.constructor.name);
    `,
    "loads-at-once.mjs": `export default 1;`,
    "disposes-while-opening.mjs": `
      const [kind, state, args] = [process.argv[2], JSON.parse(process.argv[3]), JSON.parse(process.argv[4])];
      // (What the opener had queued still runs, in a world that was closed under it: what that throws is the graph's.)
      const graph = new Bun.ModuleGraph({ onError: error => console.error("the opener, after dispose():", error) });
      const app = await graph.import(import.meta.dir + "/app.mjs");
      // Not awaited: whatever the opener has under way (a connect, a handshake, a listen) is cut short.
      graph.run(() => { Promise.resolve(app.open[kind](state, ...args)).catch(() => {}); });
      graph.dispose();
      console.log("disposed");
      setTimeout(() => { console.log("and the process is still running"); process.exit(1); }, 3000).unref();
    `,
    "disposes-then-opens.mjs": `
      const [kind, state, args] = [process.argv[2], JSON.parse(process.argv[3]), JSON.parse(process.argv[4])];
      const graph = new Bun.ModuleGraph();
      const app = await graph.import(import.meta.dir + "/app.mjs");
      // Queued inside the graph's context, so it runs there, and after the dispose() below.
      graph.run(() => app.call(() => queueMicrotask(() => { Promise.resolve(app.open[kind](state, ...args)).catch(() => {}); })));
      graph.dispose();
      console.log("disposed");
      setTimeout(() => { console.log("and the process is still running"); process.exit(1); }, 3000).unref();
    `,
    "app.mjs": `
      import net from "node:net";
      import http from "node:http";
      import http2 from "node:http2";
      import https from "node:https";
      import nodeTls from "node:tls";
      import dgram from "node:dgram";
      import fs from "node:fs";
      import zlib from "node:zlib";
      import crypto from "node:crypto";
      import dns from "node:dns";
      import childProcess from "node:child_process";
      import timersPromises from "node:timers/promises";
      import { promisify } from "node:util";
      import { Worker as ThreadWorker } from "node:worker_threads";
      import { pipeline } from "node:stream/promises";
      export const open = {
        interval(state) {
          const interval = setInterval(() => state.ticks++, 1);
          state.close = () => clearInterval(interval);
        },
        immediateLoop(state) {
          let stop = false;
          const loop = () => { state.ticks++; if (!stop) setImmediate(loop); };
          setImmediate(loop);
          state.close = () => { stop = true; };
        },
        serve(state) {
          const server = Bun.serve({ port: 0, fetch: () => new Response(state.tag) });
          state.port = server.port;
          state.close = () => server.stop(true);
        },
        listen(state) {
          const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { open(socket) { socket.write(state.tag); }, data() {} } });
          state.port = server.port;
          state.close = () => server.stop(true);
        },
        netServer(state) {
          const server = net.createServer(socket => { socket.on("error", () => {}); socket.write(state.tag); });
          return new Promise(resolve => server.listen(0, "127.0.0.1", () => {
            state.port = server.address().port;
            state.close = () => server.close();
            resolve();
          }));
        },
        httpServer(state) {
          const server = http.createServer((req, res) => res.end(state.tag));
          return new Promise(resolve => server.listen(0, "127.0.0.1", () => {
            state.port = server.address().port;
            state.close = () => { server.closeAllConnections(); server.close(); };
            resolve();
          }));
        },
        async udp(state) {
          const socket = await Bun.udpSocket({ hostname: "127.0.0.1", port: 0, socket: { data() { state.ticks++; } } });
          state.port = socket.port;
          state.close = () => socket.close();
        },
        async connect(state, hostPort) {
          const socket = await Bun.connect({ hostname: "127.0.0.1", port: hostPort, socket: {
            open(socket) { socket.write("tag:" + state.tag + "\\n"); },
            data() {},
            close() { state.heard.push("close"); },
          } });
          state.close = () => socket.end();
        },
        netConnect(state, hostPort) {
          const socket = net.connect(hostPort, "127.0.0.1");
          socket.on("error", () => {});
          socket.on("close", () => state.heard.push("close"));
          state.close = () => socket.destroy();
          return new Promise(resolve => socket.on("connect", () => { socket.write("tag:" + state.tag + "\\n"); resolve(); }));
        },
        webSocket(state, hostPort) {
          const ws = new WebSocket("ws://127.0.0.1:" + hostPort + "/ws?tag=" + state.tag);
          ws.onclose = () => state.heard.push("close");
          state.close = () => ws.close();
          return new Promise(resolve => { ws.onopen = () => resolve(); });
        },
        fetchInFlight(state, hostPort) {
          const controller = new AbortController();
          fetch("http://127.0.0.1:" + hostPort + "/hang?tag=" + state.tag, { signal: controller.signal }).then(
            () => { state.settled = "fulfilled"; },
            error => { state.settled = String(error?.name ?? error); },
          );
          state.close = () => controller.abort();
        },
        spawn(state, bun) {
          const proc = Bun.spawn({ cmd: [bun, "-e", "setInterval(() => {}, 1000)"], stdio: ["ignore", "ignore", "ignore"] });
          state.pid = proc.pid;
          state.close = () => proc.kill();
        },
        redis(state, hostPort) {
          // The host's server never answers HELLO: the connection stays open, connecting.
          // (The tag travels as the password of its AUTH.)
          const client = new Bun.RedisClient("redis://:tag%3A" + state.tag + "@127.0.0.1:" + hostPort, { autoReconnect: false, connectionTimeout: 60_000 });
          client.connect().catch(() => {});
          state.close = () => client.close();
        },
        s3(state, hostPort) {
          const client = new Bun.S3Client({ endpoint: "http://127.0.0.1:" + hostPort, bucket: "bucket", accessKeyId: "id", secretAccessKey: "secret" });
          client.file(state.tag).text().then(() => { state.settled = "fulfilled"; }, error => { state.settled = String(error?.name ?? error); });
          state.close = () => fetch("http://127.0.0.1:" + hostPort + "/release?tag=" + state.tag).catch(() => {});
        },
        shell(state, bun) {
          // The child says who it is in the state's file.
          const script = "require('fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)";
          Bun.$\`\${bun} -e \${script} \${state.file}\`.nothrow().quiet().then(() => {}, () => {});
          // (Never process.kill(0): that is this whole process group.)
          state.close = () => { const pid = Number(fs.readFileSync(state.file, "utf8")); if (pid > 0) try { process.kill(pid); } catch {} };
        },
        // Several commands and a builtin with a side effect after the long-running one; the promise's
        // reaction says whether it ever settled.
        shellScript(state, bun) {
          const script = "require('fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)";
          Bun.$\`\${bun} -e "1" ; \${bun} -e \${script} \${state.file} ; echo ran-after > \${state.file + ".after"} ; \${bun} -e \${script} \${state.file + ".second"}\`
            .nothrow().quiet().then(() => { state.settled = "fulfilled"; }, () => { state.settled = "rejected"; });
        },
        worker(state) {
          const worker = new Worker("data:text/javascript,setInterval(() => postMessage(1), 1)");
          worker.onmessage = () => state.ticks++;
          state.close = () => worker.terminate();
        },
        watch(state) {
          const watcher = fs.watch(state.file, () => state.ticks++);
          state.close = () => watcher.close();
        },
        broadcastChannel(state) {
          const channel = new BroadcastChannel("isolation-" + state.tag);
          channel.onmessage = () => state.ticks++;
          state.close = () => channel.close();
        },
        nestedGraph(state) {
          // A graph this graph's code makes, with a context of its own.
          const inner = new Bun.ModuleGraph({ globals: { state } });
          state.close = () => inner.dispose();
          return inner.import(import.meta.dir + "/ticker.mjs");
        },
        messagePort(state) {
          // The host keeps the other port and posts to it.
          const { port1, port2 } = new MessageChannel();
          port1.onmessage = () => state.ticks++;
          state.port = port2;
          state.close = () => port1.close();
        },
        eventTargetTimer(state) {
          // AbortSignal.timeout re-arming itself: a timer the graph never sees the id of.
          const again = () => AbortSignal.timeout(1).addEventListener("abort", () => { state.ticks++; if (!state.stop) again(); });
          again();
          state.close = () => { state.stop = true; };
        },
        serveWebSocket(state) {
          const server = Bun.serve({ port: 0, fetch: (request, server) => server.upgrade(request) ? undefined : new Response("no", { status: 400 }), websocket: {
            open(socket) { socket.send(state.tag); },
            message(socket, message) { state.ticks++; socket.send("echo:" + message); },
          } });
          state.port = server.port;
          state.close = () => server.stop(true);
        },
        httpKeepAlive(state, hostPort) {
          // An idle socket in the graph's own agent after its request has finished.
          const agent = new http.Agent({ keepAlive: true });
          state.close = () => agent.destroy();
          return new Promise((resolve, reject) => http.get({ host: "127.0.0.1", port: hostPort, path: "/tag:" + state.tag + "/", agent }, response => {
            response.resume();
            response.on("end", resolve);
          }).on("error", reject));
        },
        fsPromisesWatch(state) {
          const controller = new AbortController();
          (async () => { for await (const event of fs.promises.watch(state.file, { signal: controller.signal })) state.ticks++; })().catch(() => {});
          state.close = () => controller.abort();
        },
        unixListen(state, path) {
          const server = Bun.listen({ unix: path, socket: { open(socket) { socket.write(state.tag); }, data() {} } });
          state.close = () => server.stop(true);
        },
        netUnixServer(state, path) {
          const server = net.createServer(socket => { socket.on("error", () => {}); socket.write(state.tag); });
          return new Promise(resolve => server.listen(path, () => {
            state.close = () => server.close();
            resolve();
          }));
        },
        tlsListen(state, tls) {
          const server = Bun.listen({ hostname: "127.0.0.1", port: 0, tls, socket: { open(socket) { socket.write(state.tag); }, data() {} } });
          state.port = server.port;
          state.close = () => server.stop(true);
        },
        httpsServer(state, tls) {
          const server = https.createServer(tls, (req, res) => res.end(state.tag));
          return new Promise(resolve => server.listen(0, "127.0.0.1", () => {
            state.port = server.address().port;
            state.close = () => { server.closeAllConnections(); server.close(); };
            resolve();
          }));
        },
        http2Server(state) {
          const server = http2.createServer();
          server.on("stream", stream => { stream.respond({ ":status": 200 }); stream.end(state.tag); });
          return new Promise(resolve => server.listen(0, "127.0.0.1", () => {
            state.port = server.address().port;
            state.close = () => server.close();
            resolve();
          }));
        },
        dgram(state) {
          const socket = dgram.createSocket("udp4");
          socket.on("message", () => state.ticks++);
          return new Promise(resolve => socket.bind(0, "127.0.0.1", () => {
            state.port = socket.address().port;
            state.close = () => socket.close();
            resolve();
          }));
        },
        httpRequest(state, hostPort) {
          const request = http.get({ host: "127.0.0.1", port: hostPort, path: "/hang?tag=" + state.tag });
          request.on("error", () => {});
          state.close = () => request.destroy();
        },
        watchFile(state) {
          fs.watchFile(state.file, { interval: 1 }, () => state.ticks++);
          state.close = () => fs.unwatchFile(state.file);
        },
        async tlsConnect(state, hostPort) {
          const socket = await Bun.connect({ hostname: "127.0.0.1", port: hostPort, tls: { rejectUnauthorized: false }, socket: {
            open(socket) { socket.write("tag:" + state.tag + "\\n"); },
            data() {},
            close() { state.heard.push("close"); },
          } });
          state.close = () => socket.end();
        },
        nodeTlsConnect(state, hostPort) {
          const socket = nodeTls.connect({ host: "127.0.0.1", port: hostPort, rejectUnauthorized: false });
          socket.on("error", () => {});
          socket.on("close", () => state.heard.push("close"));
          state.close = () => socket.destroy();
          return new Promise(resolve => socket.on("secureConnect", () => { socket.write("tag:" + state.tag + "\\n"); resolve(); }));
        },
        tlsServer(state, tls) {
          const server = nodeTls.createServer(tls, socket => { socket.on("error", () => {}); socket.write(state.tag); });
          return new Promise(resolve => server.listen(0, "127.0.0.1", () => {
            state.port = server.address().port;
            state.close = () => server.close();
            resolve();
          }));
        },
        async unixConnect(state, hostPath) {
          const socket = await Bun.connect({ unix: hostPath, socket: {
            open(socket) { socket.write("tag:" + state.tag + "\\n"); },
            data() {},
            close() { state.heard.push("close"); },
          } });
          state.close = () => socket.end();
        },
        netUnixConnect(state, hostPath) {
          const socket = net.connect(hostPath);
          socket.on("error", () => {});
          socket.on("close", () => state.heard.push("close"));
          state.close = () => socket.destroy();
          return new Promise(resolve => socket.on("connect", () => { socket.write("tag:" + state.tag + "\\n"); resolve(); }));
        },
        http2Session(state, hostPort) {
          const session = http2.connect("http://127.0.0.1:" + hostPort);
          session.on("error", () => {});
          session.on("close", () => state.heard.push("close"));
          const request = session.request({ ":path": "/hang?tag=" + state.tag });
          request.on("error", () => {});
          request.end();
          state.close = () => session.destroy();
        },
        postgres(state, hostPort) {
          // The host's server never answers the startup message, which names the user: the tag.
          const sql = new Bun.SQL("postgres://tag%3A" + state.tag + "@127.0.0.1:" + hostPort + "/db?sslmode=disable", { max: 1, connectionTimeout: 60 });
          sql\`select 1\`.then(() => { state.settled = "fulfilled"; }, error => { state.settled = String(error?.code ?? error); });
          // (close() does not drop a connection that is still in its handshake: the host's end does.)
          state.close = () => {
            sql.close({ timeout: 0 }).catch(() => {});
            Bun.connect({ hostname: "127.0.0.1", port: hostPort, socket: { open(socket) { socket.write("drop:" + state.tag + "\\n"); }, data() {} } }).catch(() => {});
          };
        },
        mysql(state, hostPort) {
          // The host's server greets and then never answers the login, which names the user: the tag.
          const sql = new Bun.SQL("mysql://tag%3A" + state.tag + "@127.0.0.1:" + hostPort + "/db", { max: 1, connectionTimeout: 60, tls: false });
          sql\`select 1\`.then(() => { state.settled = "fulfilled"; }, error => { state.settled = String(error?.code ?? error); });
          // (close() does not drop a connection that is still in its handshake: the host's end does.)
          state.close = () => {
            sql.close({ timeout: 0 }).catch(() => {});
            Bun.connect({ hostname: "127.0.0.1", port: hostPort, socket: { open(socket) { socket.write("drop:" + state.tag + "\\n"); }, data() {} } }).catch(() => {});
          };
        },
        timersPromisesInterval(state) {
          const controller = new AbortController();
          (async () => { for await (const tick of timersPromises.setInterval(1, undefined, { signal: controller.signal })) state.ticks++; })().catch(() => {});
          state.close = () => controller.abort();
        },
        childProcessSpawn(state, bun) {
          const child = childProcess.spawn(bun, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
          child.on("error", () => {});
          state.pid = child.pid;
          state.close = () => child.kill();
        },
      };

      // A c-ares query to a server of the host's that answers when the host says so.
      export function resolveThrough(state, dnsPort) {
        const resolver = new dns.Resolver();
        resolver.setServers(["127.0.0.1:" + dnsPort]);
        resolver.resolve4(state.tag + ".test", error => { state.settled = String(error?.code ?? "fulfilled"); });
      }

      // For the tests of whose context a call runs in.
      export const call = (fn, ...args) => fn(...args);
      export const later = (fn, ...args) => new Promise(resolve => setTimeout(() => resolve(fn(...args)), 1));
      export const deferred = () => Promise.withResolvers();
      export const target = () => new EventTarget();
      export async function awaitThenOpen(promise, state) { await promise; open.interval(state); }
      export function throwFromTimer(message) { setTimeout(() => { throw new Error(message); }, 1); }
      export function rejectFromSocket(hostPort, message) {
        return Bun.connect({ hostname: "127.0.0.1", port: hostPort, socket: { open(socket) { socket.end(); Promise.reject(new Error(message)); }, data() {} } });
      }
      // Ways to get from one step to the next. The first group needs the event loop to deliver
      // something; the second is run by whatever drains microtasks and nextTicks.
      export const loopHops = {
        timeout0: next => setTimeout(next, 0),
        timeout1: next => setTimeout(next, 1),
        immediate: next => setImmediate(next),
        interval: next => { const interval = setInterval(() => { clearInterval(interval); next(); }, 0); },
        sleep: next => Bun.sleep(0).then(next),
        awaitTimer: next => { (async () => { await new Promise(resolve => setTimeout(resolve, 0)); next(); })(); },
        immediatePromise: next => new Promise(resolve => setImmediate(resolve)).then(next),
        messageChannel: next => { const { port1, port2 } = new MessageChannel(); port1.onmessage = () => { port1.close(); next(); }; port2.postMessage(0); },
        fsStat: (next, state) => fs.promises.stat(state.file).then(next),
      };
      export const microHops = {
        nextTick: next => process.nextTick(next),
        microtask: next => queueMicrotask(next),
        then: next => Promise.resolve().then(next),
        await: next => { (async () => { await null; next(); })(); },
      };
      const hops = { ...loopHops, ...microHops };
      // Steps through "order" (names of hops) again and again until state.stop or "steps" steps.
      // state.pending is the hop the chain is waiting on. check() is called at every step and what
      // it returns, if not state.tag, is counted in state.wrong. Every throwEvery-th step throws
      // after scheduling the next one.
      export function chain(state, order, { steps = Infinity, check, throwEvery = 0 } = {}) {
        let i = 0;
        const step = () => {
          state.arrivedBy = state.pending;
          state.pending = undefined;
          if (check) { const found = check(); if (found !== state.tag) state.wrong.push(state.ticks + " via " + state.arrivedBy + ": " + found); }
          state.ticks++;
          if (state.stop || state.ticks >= steps) { state.close?.(); return; }
          const name = order[i++ % order.length];
          state.pending = name;
          hops[name](step, state);
          if (throwEvery && state.ticks % throwEvery === 0) throw new Error(state.tag + " step " + state.ticks + " after " + name);
        };
        return new Promise(resolve => { state.close = resolve; step(); });
      }

      // A request: a few hops (which ones depends on the request), then something opened for it.
      const requestHops = [...Object.keys(loopHops).filter(name => name !== "fsStat"), ...Object.keys(microHops)];
      export async function handle(id, state, requestState) {
        for (let i = 0; i < 4; i++) await new Promise(resolve => hops[requestHops[(id * 7 + i * 3) % requestHops.length]](resolve, state));
        open.interval(requestState);
        return state.tag;
      }
      // The graph's own server: request ?id=N opens something for requestStates[N]; ?hold=1 waits for release().
      export function serveRequests(state, requestStates) {
        const held = Promise.withResolvers();
        const server = Bun.serve({
          port: 0,
          async fetch(request) {
            const url = new URL(request.url);
            if (url.searchParams.has("hold")) { state.ticks++; await held.promise; }
            const id = Number(url.searchParams.get("id"));
            return new Response(await handle(id, state, requestStates[id]));
          },
        });
        state.port = server.port;
        state.close = () => { held.resolve(); server.stop(true); };
        return () => held.resolve();
      }

      // Work whose result the event loop delivers later, by what starts it.
      const dataFile = import.meta.dir + "/data.txt";
      // One step of a loop that starts the next as soon as the last has settled, either way. Every
      // step waits for the event loop (none settles from a microtask alone).
      export const steps = {
        "fetch a server that never answers": ({ http }) => fetch("http://127.0.0.1:" + http + "/hang?tag=retry"),
        "fetch a refused port": () => fetch("http://127.0.0.1:1/"),
        "Bun.spawn().exited": () => Bun.spawn({ cmd: [process.execPath, "-e", "setTimeout(() => {}, 1e6)"], stdio: ["ignore", "ignore", "ignore"] }).exited,
        "Bun.connect to a server that accepts": ({ tcp }) => Bun.connect({ hostname: "127.0.0.1", port: tcp, socket: { data() {} } }).then(socket => new Promise(resolve => setTimeout(resolve, 1e6))),
        "WebSocket": ({ http }) => new Promise((resolve, reject) => { const socket = new WebSocket("ws://127.0.0.1:" + http + "/hang"); socket.onerror = socket.onclose = reject; }),
        "node:http request": ({ http: port }) => new Promise((resolve, reject) => http.get({ host: "127.0.0.1", port, path: "/hang?tag=retry-http" }).on("error", reject)),
        "node:net connect": ({ tcp }) => new Promise((resolve, reject) => net.connect(tcp, "127.0.0.1").on("error", reject).on("close", reject)),
        "Bun.SQL query": ({ tcp }) => new Bun.SQL("postgres://u@127.0.0.1:" + tcp + "/db?sslmode=disable", { max: 1 })\`select 1\`,
        "crypto.subtle.digest": () => crypto.subtle.digest("SHA-256", new Uint8Array(8)),
        "Bun.build": () => Bun.build({ entrypoints: [import.meta.path] }),
        "WebAssembly.compile": () => WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])),
        "fs.promises.readFile": () => fs.promises.readFile(import.meta.path),
        "Bun.file().text()": () => Bun.file(import.meta.path).text(),
        "zlib.gzip": () => promisify(zlib.gzip)("hello"),
        "dns.lookup": () => dns.promises.lookup("localhost"),
        "setTimeout": () => new Promise(resolve => setTimeout(resolve, 1)),
        "setImmediate": () => new Promise(resolve => setImmediate(resolve)),
        "MessageChannel": () => new Promise(resolve => { const { port1, port2 } = new MessageChannel(); port1.onmessage = () => { port1.close(); resolve(); }; port2.postMessage(1); }),
        "Bun.udpSocket": () => Bun.udpSocket({ hostname: "127.0.0.1", port: 0, socket: { data() {} } }).then(socket => new Promise(resolve => setTimeout(() => { socket.close(); resolve(); }, 1))),
        "child_process.exec": () => promisify(childProcess.exec)("exit 0"),
        // (While the graph lives each load takes turns of the event loop. Rejected at once by a disposed
        // graph, it would be retried at once: a loop of microtasks the host never gets out of.)
        "import() of a module it has not loaded": () => import("./loads-at-once.mjs?" + Math.random().toString(36).slice(2)),
        "a worker_threads Worker, until it exits": () => new Promise((resolve, reject) => { const worker = new ThreadWorker("", { eval: true }); worker.on("exit", resolve); worker.on("error", reject); }),
        "Bun.listen and a Bun.connect to it, until the client has closed": () => new Promise((resolve, reject) => {
          const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
          const done = () => { server.stop(true); resolve(); };
          Bun.connect({ hostname: "127.0.0.1", port: server.port, socket: { open(socket) { socket.end(); }, data() {}, close: done, error: done, connectError: done } }).catch(done);
        }),
      };
      // Things of the host's, or of the realm's, that a graph's code only uses.
      export const getThrough = (agent, port, path) => new Promise((resolve, reject) => http.get({ host: "127.0.0.1", port, path, agent }, response => { response.resume(); response.on("end", resolve); }).on("error", reject));
      export function serveHttp2Once(state) {
        const server = http2.createServer((request, response) => response.end(state.tag));
        return new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(server.address().port)));
      }
      // One of each thing that can tell its owner that it ended, with every handler it has noting
      // what it hears. state.close() ends them all from outside (what the host does with its own).
      export async function everythingThatReports(state, ports, bun) {
        const note = what => state.heard.push(what);
        const socket = await Bun.connect({ hostname: "127.0.0.1", port: ports.tcp, socket: {
          open(socket) { socket.write("tag:" + state.tag + "\\n"); },
          data() {}, end() { note("Bun.connect end"); }, close() { note("Bun.connect close"); }, error() { note("Bun.connect error"); },
        } });
        const netSocket = net.connect(ports.tcp, "127.0.0.1");
        for (const event of ["end", "close", "error"]) netSocket.on(event, () => note("net.Socket " + event));
        await new Promise(resolve => netSocket.on("connect", resolve));
        const ws = new WebSocket("ws://127.0.0.1:" + ports.http + "/ws?tag=" + state.tag);
        await new Promise(resolve => { ws.onopen = resolve; });
        ws.onclose = () => note("WebSocket close");
        ws.onerror = () => note("WebSocket error");
        const controller = new AbortController();
        fetch("http://127.0.0.1:" + ports.http + "/hang?tag=" + state.tag + "-fetch", { signal: controller.signal }).then(() => note("fetch fulfilled"), () => note("fetch rejected"));
        const request = http.get({ host: "127.0.0.1", port: ports.http, path: "/hang?tag=" + state.tag + "-http", agent: false });
        for (const event of ["error", "close", "response"]) request.on(event, () => note("http.ClientRequest " + event));
        const child = Bun.spawn({ cmd: [bun, "-e", "setInterval(() => {}, 1000)"], stdio: ["ignore", "pipe", "ignore"], onExit() { note("Bun.spawn onExit"); } });
        child.exited.then(() => note("Bun.spawn exited"));
        new Response(child.stdout).text().then(() => note("Bun.spawn stdout ended"), () => note("Bun.spawn stdout failed"));
        const nodeChild = childProcess.spawn(bun, ["-e", "setInterval(() => {}, 1000)"], { stdio: ["ignore", "pipe", "ignore"] });
        for (const event of ["exit", "close", "error"]) nodeChild.on(event, () => note("ChildProcess " + event));
        nodeChild.stdout.on("end", () => note("ChildProcess stdout end"));
        nodeChild.stdout.resume();
        const worker = new ThreadWorker("setInterval(() => {}, 1000)", { eval: true });
        for (const event of ["exit", "error"]) worker.on(event, () => note("Worker " + event));
        await new Promise(resolve => worker.on("online", resolve));
        const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("x") });
        const interval = setInterval(() => { state.ticks++; }, 1);
        state.pids = [child.pid, nodeChild.pid];
        state.close = () => {
          socket.end(); netSocket.destroy(); ws.close(); controller.abort(); request.destroy();
          child.kill(); nodeChild.kill(); worker.terminate(); clearInterval(interval);
          server.stop(true).then(() => note("server.stop() fulfilled"));
        };
      }
      // What script can make happen with something it opens before anybody could close it: a
      // datagram sent, a server announced.
      export function effects(state, hostUdpPort, tls) {
        const note = what => state.heard.push(what);
        const datagram = "effect:" + state.tag;
        // (Made in the turn that disposes, it is closed by the time its promise's reaction runs: send() throws.)
        Bun.udpSocket({ hostname: "127.0.0.1", port: 0 }).then(socket => { socket.send(datagram, hostUdpPort, "127.0.0.1"); note("Bun.udpSocket sent"); }).catch(() => {});
        const socket = dgram.createSocket("udp4");
        socket.on("error", () => {});
        socket.bind(0, "127.0.0.1", () => { note("dgram bound"); socket.send(datagram, hostUdpPort, "127.0.0.1"); });
        const servers = { net: net.createServer(), tls: nodeTls.createServer(tls), http: http.createServer(), https: https.createServer(tls), http2: http2.createServer() };
        for (const [name, server] of Object.entries(servers)) {
          server.on("error", () => {});
          server.listen(0, "127.0.0.1", () => note(name + " listening"));
        }
        state.close = () => { socket.close(); for (const server of Object.values(servers)) server.close(); };
      }
      // Several of one kind of background work; the first to settle calls dispose(). What had
      // settled by then (its handlers are queued microtasks, which still run) is recorded.
      export function race(name, count, state, dispose) {
        const started = [];
        const settled = () => {
          if (state.ticks++ !== 0) return;
          state.settledAtDispose = started.filter(promise => Bun.peek.status(promise) !== "pending").length;
          dispose();
        };
        for (let i = 0; i < count; i++) {
          const promise = Promise.resolve(background[name]());
          started.push(promise);
          promise.then(settled, settled);
        }
      }
      // Native single-file copies (fs.cp's fast path), by promise and by callback.
      export function copies(from, to, count, state, onFirst) {
        const settled = () => { if (state.ticks++ === 0) onFirst(); };
        for (let i = 0; i < count; i++) {
          fs.promises.cp(from, to + "-promise-" + i).then(settled, settled);
          fs.cp(from, to + "-callback-" + i, settled);
        }
      }
      export function retryForever(name, state, ports) {
        (async () => { for (;;) { try { await steps[name](ports); } catch {} state.ticks++; } })();
      }
      export const background = {
        "fs.promises.readFile": () => fs.promises.readFile(dataFile, "utf8"),
        "fs.readFile callback": () => new Promise(resolve => fs.readFile(dataFile, resolve)),
        "fs.promises.stat": () => fs.promises.stat(dataFile),
        "fs.promises.readdir": () => fs.promises.readdir(import.meta.dir),
        "fs.createReadStream": () => new Promise(resolve => fs.createReadStream(dataFile).on("data", () => {}).on("close", resolve)),
        "Bun.file().text()": () => Bun.file(dataFile).text(),
        "Bun.file().arrayBuffer()": () => Bun.file(dataFile).arrayBuffer(),
        "Bun.file().stream()": async () => { for await (const chunk of Bun.file(dataFile).stream()) void chunk; },
        "zlib.gzip": () => promisify(zlib.gzip)("hello"),
        "zlib.brotliCompress": () => promisify(zlib.brotliCompress)("hello"),
        "zlib.zstdCompress": () => promisify(zlib.zstdCompress)("hello"),
        "Bun.zstdCompress": () => Bun.zstdCompress("hello"),
        "Bun.password.hash": () => Bun.password.hash("pw", { algorithm: "bcrypt", cost: 4 }),
        "crypto.pbkdf2": () => promisify(crypto.pbkdf2)("pw", "salt", 1000, 32, "sha256"),
        "crypto.scrypt": () => promisify(crypto.scrypt)("pw", "salt", 32),
        "crypto.randomBytes": () => promisify(crypto.randomBytes)(16),
        "crypto.generateKeyPair": () => promisify(crypto.generateKeyPair)("ec", { namedCurve: "P-256" }),
        "crypto.subtle.digest": () => crypto.subtle.digest("SHA-256", new Uint8Array(1024)),
        "dns.lookup": () => promisify(dns.lookup)("localhost"),
        "Bun.dns.lookup": () => Bun.dns.lookup("localhost"),
        "Bun.Glob.scan": async () => { for await (const found of new Bun.Glob("*").scan(import.meta.dir)) void found; },
        "Bun.build": () => Bun.build({ entrypoints: [import.meta.dir + "/entry.js"], write: false }),
        "Bun.sleep": () => Bun.sleep(1),
        "timers/promises": () => timersPromises.setTimeout(1),
        "fetch(file:)": () => fetch("file://" + dataFile).then(response => response.text()),
        "fetch(data:)": () => fetch("data:text/plain,hi").then(response => response.text()),
        "CompressionStream": () => new Response(new Blob(["x".repeat(1000)]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer(),
        // Over 128 KB a chunk is coded on a thread pool, one step scheduling the next.
        "CompressionStream (off-thread)": () => new Response(new Blob([Buffer.alloc(1 << 20, "abcdefgh")]).stream().pipeThrough(new CompressionStream("gzip")).pipeThrough(new DecompressionStream("gzip"))).arrayBuffer(),
        "Bun.write(file, Blob)": () => Bun.write(dataFile + ".big", new Blob([Buffer.alloc(1 << 20, "x")])),
        // (On Windows a file sink's writes complete from the event loop.)
        "Bun.file().writer(): write, end": async () => { const writer = Bun.file(dataFile + ".sink-" + Math.random().toString(36).slice(2)).writer(); // (end() while the write is in flight: a promise on Windows, a number on POSIX.)
          writer.write(Buffer.alloc(1 << 20, "x"));
          await writer.end(); },
        "Bun.spawn stdin: write, end": async () => { const child = Bun.spawn({ cmd: [process.execPath, "-e", "process.stdin.resume()"], stdin: "pipe", stdout: "ignore", stderr: "ignore" }); child.stdin.write(Buffer.alloc(1 << 16, "x")); await child.stdin.end(); },
        "Bun.write(file, file)": () => Bun.write(dataFile + ".copy", Bun.file(dataFile)),
        "MessageChannel": () => new Promise(resolve => { const { port1, port2 } = new MessageChannel(); port1.onmessage = () => { port1.close(); resolve(); }; port2.postMessage(1); }),
        "BroadcastChannel": () => new Promise(resolve => { const name = "race-" + Math.random().toString(36).slice(2); const receiver = new BroadcastChannel(name), sender = new BroadcastChannel(name); receiver.onmessage = () => { receiver.close(); sender.close(); resolve(); }; sender.postMessage(1); }),
        "Worker": () => new Promise(resolve => { const worker = new Worker("data:text/javascript,postMessage(1)"); worker.onmessage = () => resolve(); }),
        "child_process.exec": () => promisify(childProcess.exec)("echo hi"),
        "fs.promises.writeFile": () => fs.promises.writeFile(dataFile + ".written", "x"),
        "fs.promises.appendFile": () => fs.promises.appendFile(dataFile + ".appended", "x"),
        "fs.promises.copyFile": () => fs.promises.copyFile(dataFile, dataFile + ".copied"),
        "fs.promises.mkdir": () => fs.promises.mkdir(dataFile + ".dir/a/b", { recursive: true }),
        "fs.promises.access": () => fs.promises.access(dataFile),
        "fs.promises.open": () => fs.promises.open(dataFile).then(handle => handle.close()),
        "fs.stat callback": () => new Promise(resolve => fs.stat(dataFile, resolve)),
        "fs.createWriteStream": () => new Promise(resolve => fs.createWriteStream(dataFile + ".streamed").end("x", resolve)),
        "stream pipeline through gzip": () => pipeline(fs.createReadStream(dataFile), zlib.createGzip(), fs.createWriteStream(dataFile + ".gz")),
        "zlib.createGzip stream": () => new Promise(resolve => { const gzip = zlib.createGzip(); gzip.on("data", () => {}).on("end", resolve); gzip.end("hello"); }),
        "zlib.deflate": () => promisify(zlib.deflate)("hello"),
        "zlib.gunzip": () => promisify(zlib.gunzip)(zlib.gzipSync("hello")),
        "Bun.zstdDecompress": () => Bun.zstdDecompress(Bun.zstdCompressSync("hello")),
        "Bun.password.verify": () => Bun.password.verify("pw", "$2b$04$abcdefghijklmnopqrstuuJ5vQp8uC8yM8Ck3m5qvJ3T0Y0wL0ZbW").catch(() => {}),
        "crypto.hkdf": () => promisify(crypto.hkdf)("sha256", "key", "salt", "info", 32),
        "crypto.randomFill": () => promisify(crypto.randomFill)(new Uint8Array(16)),
        "crypto.randomInt": () => promisify(crypto.randomInt)(100),
        "crypto.generatePrime": () => promisify(crypto.generatePrime)(64),
        "crypto.generateKey": () => promisify(crypto.generateKey)("hmac", { length: 256 }),
        "crypto.subtle.generateKey": () => crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]),
        "Bun.file().json()": () => Bun.file(dataFile).json().catch(() => {}),
        "Bun.file().bytes()": () => Bun.file(dataFile).bytes(),
        "Bun.file().exists()": () => Bun.file(dataFile).exists(),
        "Bun.file().stat()": () => Bun.file(dataFile).stat(),
        "Bun.write(file, string)": () => Bun.write(dataFile + ".string", "x"),
        "Bun.write(file, Response)": () => Bun.write(dataFile + ".response", new Response("x")),
        "new Bun.Transpiler().transform": () => new Bun.Transpiler({ loader: "ts" }).transform("const a: number = 1;"),
        "fetch(blob:)": () => { const url = URL.createObjectURL(new Blob(["hi"])); return fetch(url).then(response => response.text()).finally(() => URL.revokeObjectURL(url)); },
        "AbortSignal.timeout": () => new Promise(resolve => AbortSignal.timeout(1).addEventListener("abort", resolve)),
        "scheduler.wait": () => timersPromises.scheduler.wait(1),
        "setImmediate": () => new Promise(resolve => setImmediate(resolve)),
        "WebAssembly.compile": () => WebAssembly.compile(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])),
        "WebAssembly.instantiate": () => WebAssembly.instantiate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0])),
        "Atomics.waitAsync": () => Atomics.waitAsync(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1).value,
        "new Bun.Archive().bytes()": () => new Bun.Archive({ "a.txt": "hello" }).bytes(),
        "new Bun.Archive().files()": () => new Bun.Archive({ "a.txt": "hello" }).files(),
        "Bun.Archive.write": () => Bun.Archive.write(dataFile + ".tar", { "a.txt": "hello" }),
        // A 1x1 PNG.
        "new Bun.Image().metadata()": () => new Bun.Image(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64")).metadata(),
        "new Bun.Image().bytes()": () => new Bun.Image(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64")).bytes(),
        "crypto.sign callback": () => promisify(crypto.generateKeyPair)("ed25519").then(({ privateKey }) => promisify(crypto.sign)(null, Buffer.from("x"), privateKey)),
        "crypto.checkPrime": () => promisify(crypto.checkPrime)(7n),
        "crypto.subtle.encrypt": () => crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]).then(key => crypto.subtle.encrypt({ name: "AES-GCM", iv: new Uint8Array(12) }, key, new Uint8Array(8))),
        "crypto.subtle.deriveBits": () => crypto.subtle.importKey("raw", new Uint8Array(8), "PBKDF2", false, ["deriveBits"]).then(key => crypto.subtle.deriveBits({ name: "PBKDF2", salt: new Uint8Array(8), iterations: 10, hash: "SHA-256" }, key, 128)),
        "fs.promises.rm": () => fs.promises.rm(dataFile + ".missing", { force: true, recursive: true }),
        "fs.promises.cp": () => fs.promises.cp(dataFile, dataFile + ".cp"),
        "fs.promises.realpath": () => fs.promises.realpath(dataFile),
        "fs.promises.opendir": () => fs.promises.opendir(import.meta.dir).then(async directory => { for await (const entry of directory) break; }),
        "fs.promises.mkdtemp": () => fs.promises.mkdtemp(dataFile + "-tmp-"),
        "FileHandle.read": () => fs.promises.open(dataFile).then(handle => handle.read(Buffer.alloc(4), 0, 4, 0).finally(() => handle.close())),
        "Bun.file().slice().text()": () => Bun.file(dataFile).slice(0, 2).text(),
        "Bun.file().delete()": () => Bun.write(dataFile + ".deleted", "x").then(() => Bun.file(dataFile + ".deleted").delete()),
        "Bun.spawn().exited": () => Bun.spawn({ cmd: [process.execPath, "-e", "1"], stdio: ["ignore", "ignore", "ignore"] }).exited,
      };

      // One compressed chunk that expands to many times the stream's step size: decoded on the
      // thread pool in many steps, each scheduled by the completion of the one before.
      export function decompressALot(state, gzipped) {
        const counted = new TransformStream({ transform(part) { state.ticks++; } });
        return new Response(new Blob([gzipped]).stream().pipeThrough(new DecompressionStream("gzip")).pipeThrough(counted)).arrayBuffer();
      }

      // A multipart upload: every request after the first is issued from the response to the one before.
      export function uploadInParts(state, endpoint) {
        const client = new Bun.S3Client({ endpoint, bucket: "bucket", accessKeyId: "id", secretAccessKey: "secret" });
        const part = Buffer.alloc(5 * 1024 * 1024, state.tag);
        return (async () => {
          const writer = client.file(state.tag).writer({ partSize: part.length, queueSize: 1, retry: 0 });
          for (let i = 0; i < 4; i++) { writer.write(part); await writer.flush(); state.ticks++; }
          await writer.end();
          state.settled = "uploaded";
        })().catch(error => { state.settled = String(error?.code ?? error); });
      }

      export function queueEverything(log) {
        process.nextTick(() => log.push("nextTick"));
        queueMicrotask(() => log.push("microtask"));
        Promise.resolve().then(() => log.push("then"));
        (async () => { await 1; log.push("await"); await new Promise(resolve => setTimeout(resolve, 1)); log.push("await after a timer"); })();
        setTimeout(() => log.push("timeout"), 1);
        setImmediate(() => log.push("immediate"));
        Bun.sleep(1).then(() => log.push("Bun.sleep"));
      }
      export function numericTimer(state) { return +setInterval(() => state.ticks++, 1); }
      export function clearByNumber(id) { clearInterval(id); clearTimeout(id); clearInterval(String(id)); }
    `,
  }),
);
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const appPath = join(dir, "app.mjs");

let stateCount = 0;
function newState(tag: string): State {
  // What fs.watch watches is the state's own file; what a chain stats is just some file.
  let file = appPath;
  if (/^(watch|shell|fsPromisesWatch)/.test(tag)) writeFileSync((file = join(dir, `watched-${++stateCount}.txt`)), "0");
  return {
    tag,
    ticks: 0,
    port: 0,
    pid: 0,
    settled: undefined,
    heard: [],
    file,
    close: undefined,
    stop: false,
    pending: undefined,
    arrivedBy: undefined,
    wrong: [],
  };
}

/** Resolves after a 1ms host timer fired `turns` times: long enough for anything live on a 1ms cadence to have run. */
async function hostTimerTurns(turns = 20): Promise<void> {
  let fired = 0;
  const { promise, resolve } = Promise.withResolvers<void>();
  const interval = setInterval(() => {
    if (++fired >= turns) resolve();
  }, 1);
  try {
    await promise;
  } finally {
    clearInterval(interval);
  }
}
/** Whether `state.ticks` advances (after `poke`, if what ticks needs to be poked) within a bounded wait. */
async function ticks(state: State, poke?: () => void | Promise<void>): Promise<boolean> {
  const before = state.ticks;
  for (let i = 0; i < 10 && state.ticks === before; i++) {
    await poke?.();
    await hostTimerTurns(5);
  }
  return state.ticks !== before;
}
/** For each state, whether it ticked while the host's 1ms timer fired 30 times. */
async function ticking(states: State[]): Promise<boolean[]> {
  const before = states.map(state => state.ticks);
  await hostTimerTurns(30);
  return states.map((state, i) => state.ticks !== before[i]);
}
async function accepts(port: number): Promise<boolean> {
  try {
    const socket = await Bun.connect({ hostname: "127.0.0.1", port, socket: { data() {} } });
    socket.end();
    return true;
  } catch {
    return false;
  }
}
/** Resolves with the first truthy `condition()`; throws after about 3s without one. */
async function until<T>(condition: () => T | Promise<T>): Promise<T> {
  const deadline = Date.now() + 3000;
  do {
    const value = await condition();
    if (value) return value;
    await Bun.sleep(5);
  } while (Date.now() < deadline);
  throw new Error("condition never became true: " + condition);
}
/** Whether the server on `port` is the one that greets with `tag` (a freed port may be another test's by now). */
async function greets(port: number, tag: string): Promise<boolean> {
  const { promise, resolve } = Promise.withResolvers<boolean>();
  try {
    const socket = await Bun.connect({
      hostname: "127.0.0.1",
      port,
      socket: {
        data(socket, data) {
          resolve(data.toString() === tag);
          socket.end();
        },
        close: () => resolve(false),
        error: () => resolve(false),
      },
    });
    void socket;
  } catch {
    return false;
  }
  return promise;
}
/** `greets`, for a server on a Unix domain socket or one that speaks TLS. */
async function greetsThrough(options: object, tag: string): Promise<boolean> {
  const { promise, resolve } = Promise.withResolvers<boolean>();
  try {
    await Bun.connect({
      ...options,
      socket: {
        data(socket, data) {
          resolve(data.toString() === tag);
          socket.end();
        },
        close: () => resolve(false),
        error: () => resolve(false),
      },
    } as Parameters<typeof Bun.connect>[0]);
  } catch {
    return false;
  }
  return promise;
}
/** Where a Unix domain socket named `name` lives; on Windows, the named pipe that stands in for it. */
const localSocketPath = (name: string) =>
  isWindows ? `\\\\.\\pipe\\module-graph-isolation-${process.pid}-${name}` : join(dir, name + ".sock");
const unixPath = (state: State) => localSocketPath(state.tag);
/** Whether the HTTP/2 (cleartext) server on the state's port answers with its tag. */
function servesTagOverHttp2(state: State): Promise<boolean> {
  const { promise, resolve } = Promise.withResolvers<boolean>();
  const session = http2.connect("http://127.0.0.1:" + state.port);
  session.on("error", () => resolve(false));
  const request = session.request({ ":path": "/" });
  let body = "";
  request.on("data", chunk => (body += chunk));
  request.on("end", () => resolve(body === state.tag));
  request.on("error", () => resolve(false));
  request.end();
  return promise.finally(() => session.destroy());
}
/** Whether the UDP socket on the state's port counts the datagrams it is sent. */
async function countsDatagrams(state: State): Promise<boolean> {
  // (Never bound: what a disposed graph opens.)
  if (!state.port) return false;
  // (A datagram to a closed port comes back as an error on the sender.)
  const sender = await Bun.udpSocket({ hostname: "127.0.0.1", port: 0, socket: { error() {} } });
  try {
    return await ticks(state, () => void sender.send("x", state.port, "127.0.0.1"));
  } finally {
    sender.close();
  }
}
const servesTag = async (state: State) =>
  (await fetch(`http://127.0.0.1:${state.port}/`).then(
    r => r.text(),
    () => "",
  )) === state.tag;

// The host's side of the client kinds: which tags have a connection / request open right now.
const connected = new Set<string>();
const held = new Map<string, (response: Response) => void>();
/** Socket handlers of a listener of the host's that records, as `prefix + tag`, who is connected to it.
 *  "drop:<tag>" closes that one's connection from this end. */
const tracksTags = (prefix: string) => {
  const sockets = new Map<string, Bun.Socket<{ tag?: string }>>();
  return {
    open(socket: Bun.Socket<{ tag?: string }>) {
      socket.data = {};
    },
    data(socket: Bun.Socket<{ tag?: string }>, data: Buffer) {
      const text = data.toString("latin1");
      const drop = /drop:([^\r\n]*)\r?\n/.exec(text);
      if (drop) {
        sockets.get(prefix + drop[1])?.end();
        socket.end();
        return;
      }
      // (A PostgreSQL startup message ends the user's name with a NUL.)
      const match = /tag:([^\r\n\0]*)[\r\n\0]/.exec(text);
      if (match) {
        connected.add((socket.data.tag = prefix + match[1]));
        sockets.set(socket.data.tag, socket);
      }
    },
    close(socket: Bun.Socket<{ tag?: string }>) {
      // (A TLS listener without a `handshake` handler is told `open` once the handshake is done: a
      // client that left before that closes without ever having opened.)
      if (!socket.data?.tag) return;
      connected.delete(socket.data.tag);
      sockets.delete(socket.data.tag);
    },
  };
};
/** A MySQL protocol v10 greeting (no TLS, mysql_native_password): what a server says first. */
function mysqlGreeting(): Buffer {
  const payload = Buffer.concat([
    Buffer.from([0x0a]),
    Buffer.from("8.0.0-host\0"),
    Buffer.from([1, 0, 0, 0]), // connection id
    Buffer.from("abcdefgh\0"), // auth plugin data, part 1
    Buffer.from([0xff, 0xf7]), // capabilities, low 16 bits: everything but CLIENT_SSL
    Buffer.from([0x21]), // utf8_general_ci
    Buffer.from([2, 0]), // status: autocommit
    Buffer.from([0x0f, 0x00]), // capabilities, high 16 bits: CLIENT_PLUGIN_AUTH
    Buffer.from([21]), // length of the auth plugin data
    Buffer.alloc(10),
    Buffer.from("ijklmnopqrst\0"), // auth plugin data, part 2
    Buffer.from("mysql_native_password\0"),
  ]);
  const header = Buffer.alloc(4);
  header.writeUIntLE(payload.length, 0, 3);
  return Buffer.concat([header, payload]);
}
const hostUnixPath = localSocketPath("host");
let hostTcp: Bun.TCPSocketListener<{ tag?: string }>;
let hostTls: Bun.TCPSocketListener<{ tag?: string }>;
let hostMysql: Bun.TCPSocketListener<{ tag?: string }>;
let hostKeepAlive: Bun.TCPSocketListener<{ tag?: string }>;
let hostUnix: Bun.UnixSocketListener<{ tag?: string }>;
let hostHttp2: http2.Http2Server;
let hostHttp: Bun.Server;
beforeAll(async () => {
  hostTcp = Bun.listen<{ tag?: string }>({ hostname: "127.0.0.1", port: 0, socket: tracksTags("tcp:") });
  hostTls = Bun.listen<{ tag?: string }>({
    hostname: "127.0.0.1",
    port: 0,
    tls: tlsCertificate,
    socket: tracksTags("tls:"),
  });
  hostUnix = Bun.listen<{ tag?: string }>({ unix: hostUnixPath, socket: tracksTags("unix:") });
  const keepAliveClients = tracksTags("keepalive:");
  hostKeepAlive = Bun.listen<{ tag?: string }>({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      ...keepAliveClients,
      data(socket, data) {
        // "GET /tag:<tag>/ HTTP/1.1": answered, and the connection stays open.
        keepAliveClients.data(socket, Buffer.from(data.toString("latin1").replace("/ HTTP", "\n")));
        socket.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: keep-alive\r\n\r\nok");
      },
    },
  });
  const mysqlClients = tracksTags("mysql:");
  hostMysql = Bun.listen<{ tag?: string }>({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      ...mysqlClients,
      open(socket) {
        mysqlClients.open(socket);
        socket.write(mysqlGreeting());
      },
    },
  });
  // A stream is never answered: it is open until the client goes away.
  hostHttp2 = http2.createServer();
  hostHttp2.on("stream", (stream, headers) => {
    const tag = "h2:" + new URL(String(headers[":path"]), "http://host").searchParams.get("tag");
    connected.add(tag);
    stream.on("error", () => {});
    stream.on("close", () => connected.delete(tag));
  });
  await new Promise<void>(resolve => hostHttp2.listen(0, "127.0.0.1", resolve));
  hostHttp = Bun.serve({
    port: 0,
    fetch(req, server) {
      const url = new URL(req.url);
      // ?tag=, or (an S3 object request) the last path segment.
      const tag = url.searchParams.get("tag") ?? url.pathname.split("/").pop()!;
      if (url.pathname === "/ws")
        return server.upgrade(req, { data: { tag } }) ? undefined : new Response("no", { status: 400 });
      if (url.pathname === "/release") {
        held.get(tag)?.(new Response("released", { status: 500 }));
        return new Response("ok");
      }
      // Anything else is never answered: the request is open until the client goes away (or /release).
      connected.add("http:" + tag);
      req.signal.addEventListener("abort", () => connected.delete("http:" + tag));
      return new Promise<Response>(resolve =>
        held.set(tag, response => {
          connected.delete("http:" + tag);
          resolve(response);
        }),
      );
    },
    websocket: {
      open(ws) {
        connected.add("ws:" + (ws.data as { tag: string }).tag);
      },
      message() {},
      close(ws) {
        connected.delete("ws:" + (ws.data as { tag: string }).tag);
      },
    },
  });
});
afterAll(() => {
  hostTcp.stop(true);
  hostTls.stop(true);
  hostMysql.stop(true);
  hostKeepAlive.stop(true);
  hostUnix.stop(true);
  hostHttp2.close();
  hostHttp.stop(true);
});

type Kind = {
  /** Extra arguments of the opener, after the state. */
  args?: (state: State) => unknown[];
  /** Whether what the opener opened is open / running right now. */
  alive: (state: State) => Promise<boolean>;
};
const kinds: Record<string, Kind> = {
  interval: { alive: state => ticks(state) },
  immediateLoop: { alive: state => ticks(state) },
  serve: { alive: servesTag },
  listen: { alive: state => greets(state.port, state.tag) },
  netServer: { alive: state => greets(state.port, state.tag) },
  httpServer: { alive: servesTag },
  udp: { alive: countsDatagrams },
  connect: { args: () => [hostTcp.port], alive: async state => connected.has("tcp:" + state.tag) },
  netConnect: { args: () => [hostTcp.port], alive: async state => connected.has("tcp:" + state.tag) },
  webSocket: { args: () => [hostHttp.port], alive: async state => connected.has("ws:" + state.tag) },
  fetchInFlight: {
    args: () => [hostHttp.port],
    alive: async state => state.settled === undefined && connected.has("http:" + state.tag),
  },
  spawn: {
    args: () => [bunExe()],
    alive: async state => {
      try {
        process.kill(state.pid, 0);
        return true;
      } catch {
        return false;
      }
    },
  },
  redis: { args: () => [hostTcp.port], alive: async state => connected.has("tcp:" + state.tag) },
  s3: {
    args: () => [hostHttp.port],
    alive: async state => state.settled === undefined && connected.has("http:" + state.tag),
  },
  shell: {
    args: () => [bunExe()],
    alive: async state => {
      const pid = Number(readFileSync(state.file, "utf8"));
      try {
        return pid > 0 && (process.kill(pid, 0), true);
      } catch {
        return false;
      }
    },
  },
  worker: { alive: state => ticks(state) },
  watch: { alive: state => ticks(state, () => writeFileSync(state.file, String(Math.random()))) },
  broadcastChannel: {
    alive: async state => {
      const channel = new BroadcastChannel("isolation-" + state.tag);
      try {
        return await ticks(state, () => channel.postMessage(1));
      } finally {
        channel.close();
      }
    },
  },
  nestedGraph: { alive: state => ticks(state) },
  messagePort: { alive: state => ticks(state, () => state.port.postMessage(1)) },
  eventTargetTimer: { alive: state => ticks(state) },
  serveWebSocket: {
    alive: async state => {
      const { promise, resolve } = Promise.withResolvers<boolean>();
      const socket = new WebSocket(`ws://127.0.0.1:${state.port}/`);
      socket.onmessage = event => resolve(event.data === state.tag);
      socket.onerror = socket.onclose = () => resolve(false);
      try {
        return await promise;
      } finally {
        socket.close();
      }
    },
  },
  httpKeepAlive: { args: () => [hostKeepAlive.port], alive: async state => connected.has("keepalive:" + state.tag) },
  fsPromisesWatch: { alive: state => ticks(state, () => writeFileSync(state.file, String(Math.random()))) },
  // (Named pipes on Windows.)
  unixListen: { args: state => [unixPath(state)], alive: state => greetsThrough({ unix: unixPath(state) }, state.tag) },
  netUnixServer: {
    args: state => [unixPath(state)],
    alive: state => greetsThrough({ unix: unixPath(state) }, state.tag),
  },
  unixConnect: { args: () => [hostUnixPath], alive: async state => connected.has("unix:" + state.tag) },
  netUnixConnect: { args: () => [hostUnixPath], alive: async state => connected.has("unix:" + state.tag) },
  tlsConnect: { args: () => [hostTls.port], alive: async state => connected.has("tls:" + state.tag) },
  nodeTlsConnect: { args: () => [hostTls.port], alive: async state => connected.has("tls:" + state.tag) },
  tlsServer: {
    args: () => [tlsCertificate],
    alive: state =>
      greetsThrough({ hostname: "127.0.0.1", port: state.port, tls: { rejectUnauthorized: false } }, state.tag),
  },
  http2Session: {
    args: () => [(hostHttp2.address() as { port: number }).port],
    alive: async state => connected.has("h2:" + state.tag),
  },
  postgres: { args: () => [hostTcp.port], alive: async state => connected.has("tcp:" + state.tag) },
  mysql: { args: () => [hostMysql.port], alive: async state => connected.has("mysql:" + state.tag) },
  timersPromisesInterval: { alive: state => ticks(state) },
  childProcessSpawn: {
    args: () => [bunExe()],
    alive: async state => {
      try {
        process.kill(state.pid, 0);
        return true;
      } catch {
        return false;
      }
    },
  },
  tlsListen: {
    args: () => [tlsCertificate],
    alive: state =>
      greetsThrough({ hostname: "127.0.0.1", port: state.port, tls: { rejectUnauthorized: false } }, state.tag),
  },
  httpsServer: {
    args: () => [tlsCertificate],
    alive: async state =>
      (await fetch(`https://127.0.0.1:${state.port}/`, { tls: { rejectUnauthorized: false } }).then(
        response => response.text(),
        () => "",
      )) === state.tag,
  },
  http2Server: { alive: servesTagOverHttp2 },
  dgram: { alive: countsDatagrams },
  httpRequest: { args: () => [hostHttp.port], alive: async state => connected.has("http:" + state.tag) },
  watchFile: { alive: state => ticks(state, () => writeFileSync(state.file, String(Math.random()))) },
};

const hostApp = await import(appPath);
/** A graph with the app loaded; `using` disposes it however the test ends. */
async function newGraph(options: ConstructorParameters<typeof ModuleGraph>[0] = {}) {
  const graph = new ModuleGraph({ ...options });
  return { graph, app: await graph.import(appPath), [Symbol.dispose]: () => graph.dispose() };
}
/** Opens `kind` for `state` and waits until it is up. */
async function openIn(run: (fn: () => unknown) => unknown, app: any, kind: string, state: State) {
  await run(() => app.open[kind](state, ...(kinds[kind].args?.(state) ?? [])));
  await until(() => kinds[kind].alive(state));
}
const runInHost = (fn: () => unknown) => fn();

describe.concurrent("ModuleGraph isolation: disposing a graph closes what it opened, and only that", () => {
  for (const kind of Object.keys(kinds)) {
    test(kind, async () => {
      using a = await newGraph();
      using b = await newGraph();
      const states = { a: newState(kind + "-a"), b: newState(kind + "-b"), host: newState(kind + "-host") };
      const alive = (state: State) => until(() => kinds[kind].alive(state));
      const dead = (state: State) => until(async () => !(await kinds[kind].alive(state)));
      try {
        await Promise.all([
          openIn(fn => a.graph.run(fn), a.app, kind, states.a),
          openIn(fn => b.graph.run(fn), b.app, kind, states.b),
          openIn(runInHost, hostApp, kind, states.host),
        ]);

        a.graph.dispose();
        await dead(states.a);
        await Promise.all([alive(states.b), alive(states.host)]);

        b.graph.dispose();
        await dead(states.b);
        await alive(states.host);
        expect(await kinds[kind].alive(states.a)).toBe(false);
      } finally {
        // Also what dispose() should have closed, in case it did not.
        for (const state of Object.values(states)) state.close?.();
      }
      await dead(states.host);
    });
  }
});

describe.concurrent("ModuleGraph isolation: what a disposed graph opens is closed at once", () => {
  for (const kind of Object.keys(kinds)) {
    test(kind, async () => {
      using made = await newGraph();
      const state = newState(kind + "-late");
      let opening = false;
      try {
        // Queued inside the graph's context, so it runs there, and after the dispose() below:
        // what a graph had queued as a microtask still runs.
        made.graph.run(() =>
          made.app.call(() =>
            queueMicrotask(() => {
              opening = true;
              // (In a stopped context the opener may never learn that it is done.)
              Promise.resolve(made.app.open[kind](state, ...(kinds[kind].args?.(state) ?? []))).catch(() => {});
            }),
          ),
        );
        made.graph.dispose();
        await until(() => opening);
        await hostTimerTurns();
        await until(async () => !(await kinds[kind].alive(state)));
      } finally {
        state.close?.();
      }
    });
  }
});

test("ModuleGraph isolation: a disposed graph hears nothing of what it had open", async () => {
  const ports = { tcp: hostTcp.port, http: hostHttp.port };
  const gone = (pid: number) => {
    try {
      process.kill(pid, 0);
      return false;
    } catch {
      return true;
    }
  };
  // The host first: ended from outside, everything does report.
  const hostState = newState("reports-host") as State & { pids: number[] };
  await hostApp.everythingThatReports(hostState, ports, bunExe());
  hostState.close!();
  await until(() => hostState.heard.includes("server.stop() fulfilled") && hostState.pids.every(gone));
  await until(() =>
    [
      "Bun.connect close",
      "net.Socket close",
      "WebSocket close",
      "fetch rejected",
      "http.ClientRequest close",
      "Bun.spawn onExit",
      "Bun.spawn exited",
      "Bun.spawn stdout ended",
      "ChildProcess exit",
      "ChildProcess close",
      "ChildProcess stdout end",
      "Worker exit",
    ].every(what => hostState.heard.includes(what)),
  );

  using made = await newGraph();
  const state = newState("reports") as State & { pids: number[] };
  await made.graph.run(() => made.app.everythingThatReports(state, ports, bunExe()));
  await until(() =>
    ["tcp:reports", "ws:reports", "http:reports-fetch", "http:reports-http"].every(tag => connected.has(tag)),
  );
  const ticksAtDispose = state.ticks;
  made.graph.dispose();
  // All of it is closed, killed and reaped: the host's ends and the process table say so.
  await until(
    () => !["tcp:reports", "ws:reports", "http:reports-fetch", "http:reports-http"].some(tag => connected.has(tag)),
  );
  await until(() => state.pids.every(gone));
  await hostTimerTurns();
  expect({ heard: state.heard, ticksSinceDispose: state.ticks - ticksAtDispose }).toEqual({
    heard: [],
    ticksSinceDispose: 0,
  });
});

test("ModuleGraph isolation: a graph made by a graph's code is disposed with it, and a disposed graph's code loads nothing into a graph it makes", async () => {
  using made = await newGraph();
  const state = newState("nested") as State & { inner?: InstanceType<typeof ModuleGraph>; later?: () => void };
  const dep = join(dir, "dep-of-nested.mjs");
  await Bun.write(dep, "export default 1;");
  await made.graph.run(() =>
    made.app.call(async () => {
      state.inner = new ModuleGraph();
      await state.inner.import(dep);
      // What the disposed graph's leftover code does: a new graph, and a load into it.
      state.later = () =>
        void new ModuleGraph().import(dep + "?later").then(
          () => state.heard.push("fulfilled"),
          () => state.heard.push("rejected"),
        );
    }),
  );
  made.graph.run(() => made.app.call(() => queueMicrotask(state.later!)));
  made.graph.dispose();
  // The inner graph is disposed, not only stopped: the host is told so.
  expect(
    await state.inner!.import(dep).then(
      () => "fulfilled",
      (error: any) => error.code,
    ),
  ).toBe("ERR_INVALID_STATE");
  await hostTimerTurns();
  expect(state.heard).toEqual([]);
});

test("ModuleGraph isolation: a server a disposed graph was stopping says nothing: not stop()'s promise, not node:http's 'close'", async () => {
  using made = await newGraph();
  const state = newState("stopping");
  await made.graph.run(() =>
    made.app.call(async () => {
      // A request in flight keeps stop() waiting.
      const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Promise<Response>(() => {}) });
      fetch(`http://127.0.0.1:${server.port}/`).catch(() => {});
      const nodeServer = http.createServer(() => {});
      await new Promise<void>(resolve => nodeServer.listen(0, "127.0.0.1", resolve));
      nodeServer.on("close", () => state.heard.push("node:http close"));
      await until(() => server.pendingRequests === 1);
      server.stop().then(
        () => state.heard.push("stop() fulfilled"),
        () => state.heard.push("stop() rejected"),
      );
      state.port = server.port;
    }),
  );
  made.graph.dispose();
  await until(async () => !(await accepts(state.port!)));
  await hostTimerTurns();
  expect(state.heard).toEqual([]);
});

test("ModuleGraph isolation: a Bun.SQL query of a disposed graph reports nothing, in flight or started by its leftover code", async () => {
  // (The host's server never answers the startup message.)
  const query = (state: State) => {
    const sql = new Bun.SQL(`postgres://tag%3A${state.tag}@127.0.0.1:${hostTcp.port}/db?sslmode=disable`, {
      max: 1,
      connectionTimeout: 60,
    });
    sql`select 1`.then(
      () => state.heard.push("fulfilled"),
      error => state.heard.push("rejected: " + error?.code),
    );
  };
  using made = await newGraph();
  const [inFlight, startedAfter] = [newState("sql-in-flight"), newState("sql-started-after")];
  made.graph.run(() => made.app.call(() => query(inFlight)));
  await until(() => connected.has("tcp:" + inFlight.tag));
  // Queued inside the graph: runs after the dispose() below, as what a graph had queued does.
  made.graph.run(() => made.app.call(() => queueMicrotask(() => query(startedAfter))));
  made.graph.dispose();
  await until(() => !connected.has("tcp:" + inFlight.tag));
  await hostTimerTurns();
  expect({ inFlight: inFlight.heard, startedAfter: startedAfter.heard }).toEqual({ inFlight: [], startedAfter: [] });
});

test("ModuleGraph isolation: a query the host makes on a disposed graph's Bun.SQL fails instead of waiting for ever", async () => {
  // Servers that let a client in and answer nothing afterwards.
  using postgres = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      data(socket) {
        if (socket.data) return;
        socket.data = true;
        // AuthenticationOk, ReadyForQuery (idle)
        socket.write(Buffer.from([0x52, 0, 0, 0, 8, 0, 0, 0, 0, 0x5a, 0, 0, 0, 5, 0x49]));
      },
    },
  });
  using mysql = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open: socket => void socket.write(mysqlGreeting()),
      data(socket, data) {
        // OK to every packet: the handshake response, then the session setup.
        for (let at = 0; at + 4 <= data.length; at += 4 + data.readUIntLE(at, 3)) {
          socket.write(Buffer.from([7, 0, 0, data[at + 3] + 1, 0, 0, 0, 2, 0, 0, 0]));
        }
      },
    },
  });
  using made = await newGraph();
  const clients = made.graph.run(() =>
    made.app.call(() => ({
      postgres: new Bun.SQL(`postgres://u@127.0.0.1:${postgres.port}/db?sslmode=disable`, { max: 1 }),
      mysql: new Bun.SQL(`mysql://u@127.0.0.1:${mysql.port}/db`, { max: 1 }),
    })),
  ) as Record<"postgres" | "mysql", Bun.SQL>;
  await made.graph.run(() => made.app.call(() => Promise.all([clients.postgres.connect(), clients.mysql.connect()])));
  made.graph.dispose();
  const codeOf = (query: Promise<unknown>) =>
    query.then(
      () => "fulfilled",
      error => error.code,
    );
  expect({
    postgres: await codeOf(clients.postgres`select 1`),
    mysql: await codeOf(clients.mysql`select 1`),
  }).toEqual({ postgres: "ERR_POSTGRES_CONNECTION_CLOSED", mysql: "ERR_MYSQL_CONNECTION_CLOSED" });
});

// As Bun.spawn(): the child is started and then killed. 'spawn' is node:child_process's own
// announcement, made from a process.nextTick(); what the event loop would report is not.
test("ModuleGraph isolation: child_process.spawn() by a disposed graph starts nothing and announces nothing", async () => {
  using made = await newGraph();
  const state = newState("late-spawn");
  const marker = join(dir, "late-spawn-ran.txt");
  made.graph.run(() =>
    made.app.call(() =>
      queueMicrotask(() => {
        const child = require("node:child_process").spawn(bunExe(), [
          "-e",
          `require("fs").writeFileSync(${JSON.stringify(marker)}, "ran")`,
        ]);
        for (const event of ["spawn", "exit", "close", "error"]) child.on(event, () => state.heard.push(event));
        state.pid = child.pid;
      }),
    ),
  );
  made.graph.dispose();
  // The same child, started afterwards by the host, has run and exited: the graph's would have too.
  const hostMarker = join(dir, "late-spawn-host-ran.txt");
  await Bun.spawn({
    cmd: [bunExe(), "-e", `require("fs").writeFileSync(${JSON.stringify(hostMarker)}, "ran")`],
    env: bunEnv,
  }).exited;
  await hostTimerTurns();
  expect({ host: existsSync(hostMarker), graph: existsSync(marker), pid: state.pid, heard: state.heard }).toEqual({
    host: true,
    graph: false,
    pid: undefined,
    heard: [],
  });
});

describe.concurrent("ModuleGraph isolation: a disposed graph sends nothing and announces nothing", () => {
  // What it opens is closed from the event loop, a moment later: nothing may happen in between.
  // ('listening' is not from the event loop: node:net and node:http announce it themselves, from a
  // process.nextTick(), which a disposed graph's script still runs. They do not announce a server
  // that is not listening: inside the handler address() would be null.)
  for (const order of ["disposed in the turn that opens", "opens after it was disposed"] as const) {
    test(order, async () => {
      const received: string[] = [];
      const hostUdp = await Bun.udpSocket({
        hostname: "127.0.0.1",
        port: 0,
        socket: { data: (socket, data) => void received.push(data.toString()) },
      });
      try {
        // The same from the host: everything does happen when nobody is disposed.
        const hostState = newState("effects-host");
        hostApp.effects(hostState, hostUdp.port, tlsCertificate);
        try {
          await until(() => hostState.heard.length === 7 && received.length === 2);
        } finally {
          hostState.close?.();
        }

        using made = await newGraph();
        const state = newState("effects");
        made.graph.run(() => {
          if (order === "disposed in the turn that opens") made.app.effects(state, hostUdp.port, tlsCertificate);
          else made.app.call(() => queueMicrotask(() => made.app.effects(state, hostUdp.port, tlsCertificate)));
        });
        made.graph.dispose();
        // A datagram of the host's own, sent afterwards, has arrived: the graph's would have too.
        const sender = await Bun.udpSocket({ hostname: "127.0.0.1", port: 0 });
        try {
          await until(() => {
            sender.send("marker", hostUdp.port, "127.0.0.1");
            return received.includes("marker");
          });
        } finally {
          sender.close();
        }
        await hostTimerTurns();
        expect({
          heard: state.heard,
          datagrams: received.filter(datagram => datagram === "effect:" + state.tag),
        }).toEqual({
          heard: [],
          datagrams: [],
        });
      } finally {
        hostUdp.close();
      }
    });
  }
});

describe.concurrent("ModuleGraph isolation: fs.watchFile of one path by several owners", () => {
  // node:fs keeps one StatWatcher per path for all the listeners of fs.watchFile(path): per owner,
  // or disposing the graph that happened to make it would silence everybody watching that file.
  for (const first of ["graph", "host"] as const) {
    test(first + " watches first: dispose() stops the graph's listener and only it", async () => {
      using disposed = await newGraph();
      using live = await newGraph();
      const states = {
        disposed: newState("watchFile-shared-disposed"),
        live: newState("watchFile-shared-live"),
        host: newState("watchFile-shared-host"),
      };
      states.live.file = states.host.file = states.disposed.file;
      const watch = {
        graph: () => disposed.graph.run(() => disposed.app.open.watchFile(states.disposed)),
        host: () => hostApp.open.watchFile(states.host),
      };
      try {
        watch[first]();
        watch[first === "graph" ? "host" : "graph"]();
        live.graph.run(() => live.app.open.watchFile(states.live));
        // Changes the file until each of `watching` has heard of a change made after the call.
        const allHear = async (watching: State[]) => {
          const before = watching.map(state => state.ticks);
          await until(async () => {
            writeFileSync(states.disposed.file, String(Math.random()));
            await hostTimerTurns(5);
            return watching.every((state, i) => state.ticks !== before[i]);
          });
        };
        await allHear([states.disposed, states.live, states.host]);

        disposed.graph.dispose();
        const heardAtDispose = states.disposed.ticks;
        await allHear([states.live, states.host]);
        expect(states.disposed.ticks).toBe(heardAtDispose);
      } finally {
        for (const state of Object.values(states)) state.close?.();
      }
    });
  }
});

describe("ModuleGraph isolation: what is the host's, or the realm's, survives a graph that used it", () => {
  test("a keep-alive http.Agent of the host's: the socket a graph's request made it open is still the host's", async () => {
    // One socket: the host's request waits for the graph's, which is in flight when the graph is disposed.
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    try {
      using made = await newGraph();
      made.graph.run(() => made.app.getThrough(agent, hostHttp.port, "/hang?tag=agent-of-the-host")).catch(() => {});
      await until(() => connected.has("http:agent-of-the-host"));
      const hosts = hostApp.getThrough(agent, hostHttp.port, "/release?tag=nobody");
      made.graph.dispose();
      await hostTimerTurns();
      // Not closed with the graph: the request is answered on it, and the host's follows on the same socket.
      expect(connected.has("http:agent-of-the-host")).toBe(true);
      await fetch(`http://127.0.0.1:${hostHttp.port}/release?tag=agent-of-the-host`);
      await hosts;
    } finally {
      agent.destroy();
    }
  });

  test("a Bun.SQL of the host's: the connection a graph's query made it dial is still the host's", async () => {
    // (The host's server never answers the startup message, which names the user: the tag.)
    const sql = new Bun.SQL(`postgres://tag%3Asql-of-the-host@127.0.0.1:${hostTcp.port}/db?sslmode=disable`, {
      max: 1,
      connectionTimeout: 60,
    });
    try {
      using made = await newGraph();
      made.graph.run(() => made.app.call(() => void sql`select 1`.catch(() => {})));
      await until(() => connected.has("tcp:sql-of-the-host"));
      made.graph.dispose();
      await hostTimerTurns();
      expect(connected.has("tcp:sql-of-the-host")).toBe(true);
    } finally {
      // close() does not drop a connection that is still in its handshake: the host's end does.
      sql.close({ timeout: 0 }).catch(() => {});
      await Bun.connect({
        hostname: "127.0.0.1",
        port: hostTcp.port,
        socket: { open: socket => void socket.write("drop:sql-of-the-host\n"), data() {} },
      });
    }
  });

  test("node:http2's cached `date` header: the second still turns over after the graph that rendered it first is gone", async () => {
    const dateOf = (port: number) =>
      new Promise<string>((resolve, reject) => {
        const session = http2.connect(`http://127.0.0.1:${port}`);
        session.on("error", reject);
        const request = session.request({ ":path": "/" });
        request.on("response", headers => resolve(String(headers.date)));
        request.on("close", () => session.close());
        request.end();
      });
    const hostServer = http2.createServer((request, response) => response.end("host"));
    await new Promise<void>(resolve => hostServer.listen(0, "127.0.0.1", resolve));
    const hostPort = (hostServer.address() as { port: number }).port;
    try {
      {
        using made = await newGraph();
        const graphPort = await made.graph.run(() => made.app.serveHttp2Once(newState("http2-date-graph")));
        await dateOf(graphPort); // renders, and caches, the header for this second
      }
      const now = Date.now();
      setSystemTime(new Date(now + 60_000));
      expect(Math.abs(Date.parse(await dateOf(hostPort)) - (now + 60_000))).toBeLessThan(5_000);
    } finally {
      setSystemTime();
      hostServer.close();
    }
  });

  test("a PerformanceObserver of the host's keeps being called after a graph produced an entry and was disposed in the same turn", async () => {
    let entries = 0;
    const observer = new PerformanceObserver(list => void (entries += list.getEntries().length));
    observer.observe({ entryTypes: ["http"] });
    try {
      {
        using made = await newGraph();
        await made.graph.run(() => made.app.getThrough(undefined, hostHttp.port, "/release?tag=nobody"));
      }
      const afterTheGraph = entries;
      await hostApp.getThrough(undefined, hostHttp.port, "/release?tag=nobody");
      await until(() => entries > afterTheGraph);
    } finally {
      observer.disconnect();
    }
  });
});

describe.concurrent("ModuleGraph isolation: whose context a call runs in", () => {
  test("what a function opens belongs to the context it was called in, not to the graph that defined it", async () => {
    using a = await newGraph();
    using b = await newGraph();
    const viaTimer = newState("via-timer");
    const viaCall = newState("via-call");
    // A's timer calls B's function; A's code calls B's function synchronously inside A's context.
    await a.graph.run(() => a.app.later(b.app.open.interval, viaTimer));
    a.graph.run(() => a.app.call(b.app.open.interval, viaCall));
    expect([await ticks(viaTimer), await ticks(viaCall)]).toEqual([true, true]);
    b.graph.dispose();
    expect([await ticks(viaTimer), await ticks(viaCall)]).toEqual([true, true]);
    a.graph.dispose();
    expect([await ticks(viaTimer), await ticks(viaCall)]).toEqual([false, false]);
  });

  test("run() nests: the innermost graph's context is current, and the outer one is restored", async () => {
    using a = await newGraph();
    using b = await newGraph();
    const [inner, afterInner, outside] = [newState("inner"), newState("after-inner"), newState("outside")];
    try {
      a.graph.run(() => {
        b.graph.run(() => hostApp.open.interval(inner));
        hostApp.open.interval(afterInner);
      });
      hostApp.open.interval(outside);
      b.graph.dispose();
      expect([await ticks(inner), await ticks(afterInner), await ticks(outside)]).toEqual([false, true, true]);
      a.graph.dispose();
      expect([await ticks(inner), await ticks(afterInner), await ticks(outside)]).toEqual([false, false, true]);
    } finally {
      outside.close?.();
    }
  });

  test("code after an await continues in the context that awaited, whoever settles the promise", async () => {
    using a = await newGraph();
    using b = await newGraph();
    const state = newState("awaited");
    // B makes the promise and later resolves it from its own timer; A awaits it.
    const { promise, resolve } = b.graph.run(() => b.app.deferred());
    const opened = a.graph.run(() => a.app.awaitThenOpen(promise, state));
    b.graph.run(() => b.app.later(resolve));
    await opened;
    expect(await ticks(state)).toBe(true);
    b.graph.dispose();
    expect(await ticks(state)).toBe(true);
    a.graph.dispose();
    expect(await ticks(state)).toBe(false);
  });

  test("an EventEmitter listener runs in the emitter's caller's context; an EventTarget listener in its target's", async () => {
    using a = await newGraph();
    using b = await newGraph();
    const [emitted, dispatched] = [newState("emitted"), newState("dispatched")];
    const emitter = new EventEmitter();
    // Listener registered by A's code, emitted from B's context.
    a.graph.run(() => a.app.call(() => emitter.on("go", () => hostApp.open.interval(emitted))));
    b.graph.run(() => emitter.emit("go"));
    // EventTarget made by A, listener added from B's context, dispatched by the host.
    const target: EventTarget = a.graph.run(() => a.app.target());
    b.graph.run(() => target.addEventListener("go", () => hostApp.open.interval(dispatched)));
    target.dispatchEvent(new Event("go"));
    expect([await ticks(emitted), await ticks(dispatched)]).toEqual([true, true]);
    b.graph.dispose();
    expect([await ticks(emitted), await ticks(dispatched)]).toEqual([false, true]);
    a.graph.dispose();
    expect([await ticks(emitted), await ticks(dispatched)]).toEqual([false, false]);
  });

  test("AsyncLocalStorage stores flow into a graph the host enters and do not leak between graphs", async () => {
    const storage = new AsyncLocalStorage<string>();
    using a = await newGraph();
    using b = await newGraph();
    const seen: Record<string, string | undefined> = {};
    await storage.run("host-store", async () => {
      seen.insideA = a.graph.run(() => storage.getStore());
      await a.graph.run(() => a.app.later(() => (seen.insideATimer = storage.getStore())));
    });
    const aOwn = a.graph.run(() => storage.run("a-store", () => a.app.later(() => (seen.aOwn = storage.getStore()))));
    seen.bDuringA = b.graph.run(() => storage.getStore());
    await b.graph.run(() => b.app.later(() => (seen.bTimer = storage.getStore())));
    await aOwn;
    expect(seen).toEqual({
      insideA: "host-store",
      insideATimer: "host-store",
      aOwn: "a-store",
      bDuringA: undefined,
      bTimer: undefined,
    });
  });
});

describe.concurrent("ModuleGraph isolation: errors go to the graph whose code threw", () => {
  test("an exception from a timer and a rejection from a socket handler reach only that graph's onError", async () => {
    const errors: string[] = [];
    const onError = (who: string) => (error: any, kind: string) =>
      void errors.push(`${who}: ${kind}: ${error.message}`);
    using a = await newGraph({ onError: onError("a") });
    using b = await newGraph({ onError: onError("b") });
    a.graph.run(() => a.app.throwFromTimer("a's timer"));
    b.graph.run(() => b.app.throwFromTimer("b's timer"));
    await a.graph.run(() => a.app.rejectFromSocket(hostTcp.port, "a's socket"));
    await until(() => errors.length >= 3);
    await hostTimerTurns();
    expect(errors.sort()).toEqual([
      "a: uncaughtException: a's timer",
      "a: unhandledRejection: a's socket",
      "b: uncaughtException: b's timer",
    ]);
    a.graph.dispose();
    b.graph.dispose();
  });
});

describe.concurrent("ModuleGraph isolation: a graph cannot reach another graph's timers by number", () => {
  test("clearInterval / clearTimeout with another graph's numeric id does nothing; the owner, the host, and anyone for the host's, can", async () => {
    using a = await newGraph();
    using b = await newGraph();
    const [ofA, ofA2, ofHost, ofHostSetInA] = [
      newState("of-a"),
      newState("of-a-2"),
      newState("of-host"),
      newState("of-host-set-in-a"),
    ];
    const idOfA: number = a.graph.run(() => a.app.numericTimer(ofA));
    const idOfA2: number = a.graph.run(() => a.app.numericTimer(ofA2));
    const idOfHost: number = hostApp.numericTimer(ofHost);
    // A's code the host calls directly sets a timer of the host's; A's code can clear it later from its own context.
    const idOfHostSetInA: number = a.app.numericTimer(ofHostSetInA);
    try {
      b.graph.run(() => b.app.clearByNumber(idOfA));
      expect(await ticks(ofA)).toBe(true);
      a.graph.run(() => a.app.clearByNumber(idOfA));
      hostApp.clearByNumber(idOfA2);
      a.graph.run(() => a.app.clearByNumber(idOfHostSetInA));
      expect([await ticks(ofA), await ticks(ofA2), await ticks(ofHostSetInA), await ticks(ofHost)]).toEqual([
        false,
        false,
        false,
        true,
      ]);
      // The host's timers are as reachable as its globalThis.
      b.graph.run(() => b.app.clearByNumber(idOfHost));
      expect(await ticks(ofHost)).toBe(false);
    } finally {
      clearInterval(idOfHost);
      clearInterval(idOfHostSetInA);
    }
  });
});

describe.concurrent("ModuleGraph isolation: graphs that talk to each other", () => {
  test("a graph serving another: disposing the server fails the client's requests and leaves the client running", async () => {
    using server = await newGraph();
    using client = await newGraph();
    const [serving, clientTimer] = [newState("serving"), newState("client-timer")];
    await openIn(fn => server.graph.run(fn), server.app, "serve", serving);
    await openIn(fn => client.graph.run(fn), client.app, "interval", clientTimer);
    const get = () =>
      client.graph.run(() =>
        client.app.call(() =>
          fetch(`http://127.0.0.1:${serving.port}/`).then(
            r => r.text(),
            e => "failed: " + e.code,
          ),
        ),
      );
    expect(await get()).toBe("serving");
    server.graph.dispose();
    await until(async () => (await get()) !== "serving");
    expect(await get()).toBe("failed: ConnectionRefused");
    expect(await ticks(clientTimer)).toBe(true);
    client.graph.dispose();
    expect(await ticks(clientTimer)).toBe(false);
  });

  test("a socket between two graphs: disposing one end closes the other end's socket, whose close handler runs in its own live graph", async () => {
    using listener = await newGraph();
    using dialer = await newGraph();
    const [listening, dialed, afterClose] = [newState("listening"), newState("dialed"), newState("after-close")];
    await openIn(fn => listener.graph.run(fn), listener.app, "listen", listening);
    // The dialer's close handler opens a timer: it must be the dialer's.
    const closed = Promise.withResolvers<void>();
    await dialer.graph.run(() =>
      dialer.app.call(() =>
        Bun.connect({
          hostname: "127.0.0.1",
          port: listening.port,
          socket: {
            data() {},
            close() {
              dialed.heard.push("close");
              hostApp.open.interval(afterClose);
              closed.resolve();
            },
          },
        }),
      ),
    );
    listener.graph.dispose();
    await closed.promise;
    expect(dialed.heard).toEqual(["close"]);
    expect(await ticks(afterClose)).toBe(true);
    dialer.graph.dispose();
    expect(await ticks(afterClose)).toBe(false);
  });
});

describe.concurrent("ModuleGraph isolation: disposing from inside", () => {
  test("a graph disposing itself from its own timer, and disposing another graph whose code is on the stack", async () => {
    using a = await newGraph();
    using b = await newGraph();
    const [ofA, ofB, afterDisposeInB] = [newState("of-a"), newState("of-b"), newState("after-dispose-in-b")];
    a.graph.run(() => a.app.open.interval(ofA));
    b.graph.run(() => b.app.open.interval(ofB));
    // B's code calls (through A's function) something that disposes B, then carries on.
    const result = b.graph.run(() =>
      b.app.call(() => {
        a.app.call(() => b.graph.dispose());
        hostApp.open.interval(afterDisposeInB); // opened by a disposed graph: closed at once
        return "b carried on";
      }),
    );
    expect(result).toBe("b carried on");
    expect([await ticks(ofA), await ticks(ofB), await ticks(afterDisposeInB)]).toEqual([true, false, false]);
    // A disposes itself from its own timer.
    await a.graph.run(() => a.app.later(() => a.graph.dispose()));
    expect(await ticks(ofA)).toBe(false);
    // Again is a no-op.
    a.graph.dispose();
    b.graph.dispose();
  });

  test("after dispose() what the graph had already queued as microtasks and nextTicks still runs; nothing the event loop would deliver does", async () => {
    using made = await newGraph();
    const { graph, app } = made;
    const log: string[] = [];
    graph.run(() => app.queueEverything(log));
    graph.dispose();
    // The host's own, queued later, have all run: the graph's would have by now.
    await Promise.all([
      new Promise(resolve => setTimeout(resolve, 2)),
      new Promise(resolve => setImmediate(resolve)),
      Bun.sleep(2),
    ]);
    await new Promise(resolve => setImmediate(resolve));
    expect(log.sort()).toEqual(["await", "microtask", "nextTick", "then"]);
  });

  test("after dispose() no close handler of the graph is called, and the host can still use what it holds", async () => {
    using made = await newGraph();
    const { graph, app } = made;
    const state = newState("held");
    const server: Bun.Server = graph.run(() =>
      app.call(() => Bun.serve({ port: 0, fetch: () => new Response("held") })),
    );
    await graph.run(() =>
      app.call(() =>
        Bun.connect({
          hostname: "127.0.0.1",
          port: hostTcp.port,
          socket: {
            data() {},
            close() {
              state.heard.push("close");
            },
          },
        }),
      ),
    );
    const held = { ...state, port: server.port, tag: "held" };
    graph.dispose();
    await until(() => !connected.has("tcp:" + state.tag));
    await hostTimerTurns();
    expect(state.heard).toEqual([]);
    expect(await servesTag(held)).toBe(false);
    // The host's handle to the closed server is inert, not dangerous.
    expect(() => server.stop(true)).not.toThrow();
    expect(() => server.reload({ fetch: () => new Response("held") })).not.toThrow();
    expect(await servesTag(held)).toBe(false);
  });

  test("what the host opened and handed to a graph is the host's: the graph using it, then being disposed, leaves it open", async () => {
    using made = await newGraph();
    const { graph, app } = made;
    const hostState = newState("handed-over");
    hostApp.open.serve(hostState);
    const hostServer = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
    try {
      // The graph's code calls methods of the host's objects.
      expect(
        await graph.run(() => app.call(() => fetch(`http://127.0.0.1:${hostState.port}/`).then(r => r.text()))),
      ).toBe("handed-over");
      graph.run(() => app.call(() => hostServer.ref()));
      graph.dispose();
      await hostTimerTurns();
      expect(await kinds.serve.alive(hostState)).toBe(true);
      expect(await accepts(hostServer.port)).toBe(true);
    } finally {
      hostState.close?.();
      hostServer.stop(true);
    }
  });
});

describe.concurrent("ModuleGraph isolation: competing graphs", () => {
  const loopHops = Object.keys(hostApp.loopHops);
  const microHops = Object.keys(hostApp.microHops);
  // Every event-loop hop with a run of microtask hops between each two.
  const allHops = loopHops.flatMap((hop, i) => [hop, ...microHops.slice(0, 1 + (i % microHops.length))]);
  const storage = new AsyncLocalStorage<string>();
  /** Starts `state`'s chain inside the graph's context (the host's, without one) and an ALS store named after
   *  it. Every step checks that the current graph is that graph and (except after a MessagePort event, which
   *  carries no async context in the host either) that the store is still that store. */
  const start = (made: { graph: Graph; app: any } | undefined, state: State, options: object = {}) => {
    let storeLost = false;
    const check = () => {
      if (ModuleGraph.current !== made?.graph) return "in " + (ModuleGraph.current ? "another graph" : "the host");
      storeLost ||= state.arrivedBy === "messageChannel";
      if (!storeLost && storage.getStore() !== state.tag) return "store " + storage.getStore();
      return state.tag;
    };
    return storage.run(state.tag, () =>
      made
        ? made.graph.run(() => made.app.chain(state, allHops, { check, ...options }))
        : hostApp.chain(state, allHops, { check, ...options }),
    );
  };
  const advancesBy = (states: State[], steps: number) => {
    const from = states.map(state => state.ticks);
    return until(() => states.every((state, i) => state.ticks >= from[i] + steps));
  };

  test("chains of many graphs and the host interleave hop by hop; each stays in its own context and AsyncLocalStorage store through every kind of hop", async () => {
    using stack = new DisposableStack();
    const graphs = await Promise.all(Array.from({ length: 6 }, async () => stack.use(await newGraph())));
    const states = graphs.map((_, i) => newState("chain-" + i));
    const host = newState("chain-host");
    const steps = allHops.length * 4;
    await Promise.all([
      ...graphs.map((made, i) => start(made, states[i], { steps })),
      start(undefined, host, { steps }),
    ]);
    expect([...states, host].map(({ tag, ticks, wrong }) => ({ tag, ticks, wrong }))).toEqual(
      [...states, host].map(({ tag }) => ({ tag, ticks: steps, wrong: [] })),
    );
  });

  test("disposed graphs stop at their next event-loop hop while the others and the host keep going, wherever the dispose() came from", async () => {
    using stack = new DisposableStack();
    const graphs = await Promise.all(Array.from({ length: 8 }, async () => stack.use(await newGraph())));
    const states = graphs.map((_, i) => newState("race-" + i));
    const host = newState("race-host");
    const everyone = [...states, host];
    try {
      graphs.forEach((made, i) => void start(made, states[i]));
      void start(undefined, host);
      await until(() => everyone.every(state => state.ticks >= allHops.length));

      // 0: by the host. 2: from inside 1's timer. 4: from inside its own microtask. 6: from inside 5's nextTick.
      graphs[0].graph.dispose();
      await graphs[1].graph.run(() => graphs[1].app.later(() => graphs[2].graph.dispose()));
      graphs[4].graph.run(() => graphs[4].app.call(() => queueMicrotask(() => graphs[4].graph.dispose())));
      graphs[5].graph.run(() => graphs[5].app.call(() => process.nextTick(() => graphs[6].graph.dispose())));

      const disposed = [0, 2, 4, 6].map(i => states[i]);
      const live = [1, 3, 5, 7].map(i => states[i]).concat(host);
      await advancesBy(live, allHops.length * 2);
      const stoppedAt = disposed.map(state => state.ticks);
      await advancesBy(live, allHops.length * 2);
      expect(disposed.map(state => state.ticks)).toEqual(stoppedAt);
      // Each is waiting on something only the event loop delivers, which will never come.
      expect(disposed.map(state => loopHops.includes(state.pending!))).toEqual([true, true, true, true]);
      expect(everyone.map(state => state.wrong)).toEqual(everyone.map(() => []));
    } finally {
      for (const state of everyone) state.stop = true;
    }
  });

  test("callbacks due in the same batch as the one that disposes their graph: timers, intervals and immediates do not run, nextTicks and microtasks do", async () => {
    const log: string[] = [];
    const race = async (queue: (made: { graph: Graph; app: any }, fn: () => void) => void, name: string) => {
      using a = await newGraph();
      using b = await newGraph();
      using c = await newGraph();
      // Queued in this order, all due together: C's, then A's (which disposes B and C), then B's.
      queue(c, () => log.push(name + ": c ran before"));
      queue(a, () => {
        b.graph.dispose();
        c.graph.dispose();
        log.push(name + ": a disposed b and c");
      });
      queue(b, () => log.push(name + ": b ran after"));
      queue(a, () => log.push(name + ": a ran after"));
      Bun.sleepSync(3);
      await until(() => log.includes(name + ": a ran after"));
      // A host timer set now fires after anything of B's that was still to fire.
      await hostTimerTurns(3);
    };
    await race((made, fn) => made.graph.run(() => setTimeout(fn, 1)), "timeout");
    await race(
      (made, fn) =>
        made.graph.run(() => {
          const interval = setInterval(() => {
            clearInterval(interval);
            fn();
          }, 1);
        }),
      "interval",
    );
    await race((made, fn) => made.graph.run(() => setImmediate(fn)), "immediate");
    await race((made, fn) => made.graph.run(() => process.nextTick(fn)), "nextTick");
    await race((made, fn) => made.graph.run(() => queueMicrotask(fn)), "microtask");
    expect(log).toEqual([
      ...["timeout", "interval", "immediate"].flatMap(name => [
        name + ": c ran before",
        name + ": a disposed b and c",
        name + ": a ran after",
      ]),
      ...["nextTick", "microtask"].flatMap(name => [
        name + ": c ran before",
        name + ": a disposed b and c",
        name + ": b ran after",
        name + ": a ran after",
      ]),
    ]);
  });

  test("timers of several graphs and the host fire in the order they were set; a disposed graph's drop out without disturbing the rest", async () => {
    using a = await newGraph();
    using b = await newGraph();
    const fired: string[] = [];
    const set: string[] = [];
    const done = Promise.withResolvers<void>();
    for (let i = 0; i < 30; i++) {
      for (const [who, run] of [
        ["a", (fn: () => void) => a.graph.run(fn)],
        ["b", (fn: () => void) => b.graph.run(fn)],
        ["host", runInHost],
      ] as const) {
        const label = who + i;
        set.push(label);
        run(() => setTimeout(() => fired.push(label), 2));
      }
    }
    setTimeout(done.resolve, 2);
    b.graph.dispose();
    await done.promise;
    expect(fired).toEqual(set.filter(label => !label.startsWith("b")));
  });

  test("errors thrown from every kind of hop in interleaved chains reach the onError of the graph whose chain threw, before and after another graph is disposed", async () => {
    const errors: Record<string, string[]> = { "throws-0": [], "throws-1": [], "throws-2": [] };
    const onError = (tag: string) => (error: any, kind: string) => void errors[tag].push(kind + ": " + error.message);
    using stack = new DisposableStack();
    const graphs = await Promise.all(
      Object.keys(errors).map(async tag => stack.use(await newGraph({ onError: onError(tag) }))),
    );
    const states = Object.keys(errors).map(tag => newState(tag));
    try {
      graphs.forEach((made, i) => void start(made, states[i], { throwEvery: 3 }));
      await until(() => states.every(state => state.ticks >= allHops.length * 2));
      graphs[1].graph.dispose();
      await advancesBy([states[0], states[2]], allHops.length * 2);
    } finally {
      for (const state of states) state.stop = true;
    }
    for (const state of states) {
      // One error per third step (the last steps' may still be on their way), all its own.
      expect(errors[state.tag].length).toBeGreaterThanOrEqual(Math.floor(state.ticks / 3) - 2);
      expect(
        errors[state.tag].filter(
          message =>
            !/^(uncaughtException|unhandledRejection): /.test(message) || !message.includes(state.tag + " step "),
        ),
      ).toEqual([]);
    }
    expect(states.map(state => state.wrong)).toEqual([[], [], []]);
  });

  test("a host server routing interleaved requests into graphs with run(): every request stays in its graph across awaits, and what it opened is that graph's", async () => {
    using stack = new DisposableStack();
    const graphs = await Promise.all(Array.from({ length: 4 }, async () => stack.use(await newGraph())));
    const graphStates = graphs.map((_, i) => newState("routed-" + i));
    const requests = Array.from({ length: 40 }, (_, id) => ({
      id,
      graph: (id * 3) % 4,
      state: newState("request-" + id),
    }));
    using server = Bun.serve({
      port: 0,
      async fetch(request) {
        const { id, graph, state } = requests[Number(new URL(request.url).searchParams.get("id"))];
        const made = graphs[graph];
        return new Response(await made.graph.run(() => made.app.handle(id, graphStates[graph], state)));
      },
    });
    const bodies = await Promise.all(
      requests.map(({ id }) => fetch(`http://127.0.0.1:${server.port}/?id=${id}`).then(r => r.text())),
    );
    expect(bodies).toEqual(requests.map(({ graph }) => "routed-" + graph));
    const states = requests.map(request => request.state);
    expect(await ticking(states)).toEqual(requests.map(() => true));
    for (const disposed of [2, 0, 3, 1]) {
      graphs[disposed].graph.dispose();
      const gone = new Set([2, 0, 3, 1].slice(0, [2, 0, 3, 1].indexOf(disposed) + 1));
      expect(await ticking(states)).toEqual(requests.map(({ graph }) => !gone.has(graph)));
    }
  });

  test("each graph's own server under interleaved requests: handlers stay in their graph across awaits; disposing one fails only its requests in flight", async () => {
    using stack = new DisposableStack();
    const graphs = await Promise.all(Array.from({ length: 4 }, async () => stack.use(await newGraph())));
    const servers = graphs.map((_, i) => newState("server-" + i));
    const requests = Array.from({ length: 40 }, (_, id) => ({
      id,
      graph: (id * 3) % 4,
      state: newState("request-" + id),
    }));
    const requestStates = requests.map(request => request.state);
    const release = graphs.map(
      (made, i) => made.graph.run(() => made.app.serveRequests(servers[i], requestStates)) as () => void,
    );
    const get = (graph: number, query: string) =>
      fetch(`http://127.0.0.1:${servers[graph].port}/?${query}`).then(
        r => r.text(),
        () => "failed",
      );
    const bodies = await Promise.all(requests.map(({ id, graph }) => get(graph, "id=" + id)));
    expect(bodies).toEqual(requests.map(({ graph }) => "server-" + graph));
    expect(await ticking(requestStates)).toEqual(requests.map(() => true));

    // A second wave that every server holds on to; graph 1 is disposed with its share in flight.
    const held = requests.map(({ id, graph }) => get(graph, "hold=1&id=" + id));
    await until(() => servers.every(server => server.ticks === 10));
    graphs[1].graph.dispose();
    release.forEach(release => release());
    expect(await Promise.all(held)).toEqual(requests.map(({ graph }) => (graph === 1 ? "failed" : "server-" + graph)));
    expect(await ticking(requestStates)).toEqual(requests.map(({ graph }) => graph !== 1));
  });

  test("a new graph of the same files starts and finishes while the disposed one's leftovers are still draining; the host calling the disposed one's code gets the host's context", async () => {
    using first = await newGraph();
    const [old, fresh, viaHost, viaRun] = [
      newState("old"),
      newState("fresh"),
      newState("via-host"),
      newState("via-run"),
    ];
    try {
      void start(first, old);
      await until(() => old.ticks >= allHops.length);
      const inFirst = first.graph.run(() => AsyncLocalStorage.snapshot());
      first.graph.dispose();
      using second = await newGraph();
      const steps = allHops.length * 3;
      await start(second, fresh, { steps });
      expect({ ticks: fresh.ticks, wrong: fresh.wrong }).toEqual({ ticks: steps, wrong: [] });
      const stoppedAt = old.ticks;
      // The disposed graph's functions are still functions: called by the host they run as the host's
      // code; entered through what the graph left behind, what they open is closed at once.
      first.app.open.interval(viaHost);
      inFirst(() => first.app.open.interval(viaRun));
      expect([await ticks(viaHost), await ticks(viaRun)]).toEqual([true, false]);
      expect(old.ticks).toBe(stoppedAt);
    } finally {
      old.stop = true;
      viaHost.close?.();
    }
  });
});

/** Runs a fixture of `dir` in a process of its own. One that never exits (what these tests are
 *  about) fails its test by that test's timeout, and is killed instead of outliving the run. */
async function runsFixture(script: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), join(dir, script), ...args],
    env: bunEnv,
    stdout: "pipe",
    stderr: "inherit",
    timeout: 30_000,
    killSignal: "SIGKILL",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  return { stdout: stdout.trim(), exitCode };
}

describe.concurrent("ModuleGraph isolation: what a disposed graph had open does not keep the process running", () => {
  for (const kind of Object.keys(kinds)) {
    test(kind, async () => {
      const state = newState(kind + "-exits");
      expect(
        await runsFixture(
          "opens-then-disposes.mjs",
          kind,
          JSON.stringify(state),
          JSON.stringify(kinds[kind].args?.(state) ?? []),
        ),
      ).toEqual({
        stdout: "disposed",
        exitCode: 0,
      });
    });
  }
});

describe.concurrent(
  "ModuleGraph isolation: what a graph was still opening when it was disposed does not keep the process running",
  () => {
    for (const kind of Object.keys(kinds)) {
      test(kind, async () => {
        const state = newState(kind + "-opening-exits");
        expect(
          await runsFixture(
            "disposes-while-opening.mjs",
            kind,
            JSON.stringify(state),
            JSON.stringify(kinds[kind].args?.(state) ?? []),
          ),
        ).toEqual({
          stdout: "disposed",
          exitCode: 0,
        });
      });
    }
  },
);

describe.concurrent("ModuleGraph isolation: what a disposed graph opens does not keep the process running", () => {
  for (const kind of Object.keys(kinds)) {
    test(kind, async () => {
      const state = newState(kind + "-late-exits");
      expect(
        await runsFixture(
          "disposes-then-opens.mjs",
          kind,
          JSON.stringify(state),
          JSON.stringify(kinds[kind].args?.(state) ?? []),
        ),
      ).toEqual({
        stdout: "disposed",
        exitCode: 0,
      });
    });
  }
});

describe.concurrent("ModuleGraph isolation: a disposed graph cannot keep itself running", () => {
  // If what a disposed graph's leftover code starts reported back, a loop that retries on failure
  // would go on for ever inside the disposed graph (and a spawn loop would go on launching processes).
  for (const name of Object.keys(hostApp.steps)) {
    test(name, async () => {
      expect(
        await runsFixture(
          "retries-then-is-disposed.mjs",
          name,
          JSON.stringify({ http: hostHttp.port, tcp: hostTcp.port }),
        ),
      ).toEqual({ stdout: "armed\nstops", exitCode: 0 });
    });
  }
});

// A forcing function: whoever adds something to `Bun` has to say here what a graph's dispose() does
// with it. "owned": something it opens outlives the call and a test above (or in
// module-graph-io.test.ts) shows dispose() closing it. "job": its work runs on a thread pool; the
// "background work" test says which completions are dropped once the graph is disposed. "pure": nothing
// outlives the call. "host": process-wide on purpose (the graph's host decides who may use it).
describe.concurrent("ModuleGraph isolation: a disposed graph leaves nothing behind in what is the realm's", () => {
  test("its node:perf_hooks observer is disconnected: the host's requests are not buffered for it", async () => {
    const [observed, control] = await Promise.all(
      ["observe", "control"].map(async mode => {
        const { stdout, exitCode } = await runsFixture("observer-of-a-disposed-graph.mjs", mode);
        return { ...(JSON.parse(stdout) as { requests: number; kept: number }), exitCode };
      }),
    );
    // An entry buffered for the observer is a dozen objects: kept for every request, that is
    // twelve times `requests` more than the control keeps. Half of that is the line.
    expect({
      ...observed,
      keptMoreThanControl: Math.max(0, observed.kept - control.kept - 6 * observed.requests),
    }).toEqual({
      requests: observed.requests,
      kept: observed.kept,
      exitCode: 0,
      keptMoreThanControl: 0,
    });
    expect(control.exitCode).toBe(0);
  });
  // (Counts the process's descriptors through /proc/self/fd or /dev/fd.)
  test.skipIf(isWindows)("the files its fs.promises.open() calls in flight opened are closed", async () => {
    expect(await runsFixture("files-of-a-disposed-graph.mjs")).toEqual({ stdout: `{"leftOpen":0}`, exitCode: 0 });
  });
  test.skipIf(isWindows)("the stdio pipes of the children node:child_process spawned for it are closed", async () => {
    expect(await runsFixture("pipes-of-a-disposed-graph.mjs")).toEqual({
      stdout: `{"opened":true,"leftOpen":0}`,
      exitCode: 0,
    });
  });
  for (const name of ["http", "https"])
    for (const how of ["used", "loaded by what it had queued"])
      test(`the host's node:${name} requests work when a graph was the first to load node:${name} (${how})`, async () => {
        expect(await runsFixture("first-to-load-node-http.mjs", name, how)).toEqual({
          stdout: `{"status":200}`,
          exitCode: 0,
        });
      });
  test("fetch() uploads it had streaming are released", async () => {
    expect(await runsFixture("uploads-of-a-disposed-graph.mjs")).toEqual({
      stdout: `{"streaming":true,"released":true}`,
      exitCode: 0,
    });
  });
  test("an HTMLRewriter rewrite it had under way is given up without a word when the process winds down", async () => {
    expect(await runsFixture("rewrite-given-up-at-exit.mjs")).toEqual({ stdout: `{"said":[]}`, exitCode: 0 });
  });
  test("writes it had queued on the thread pool never reach the files that are given its descriptors next", async () => {
    expect(await runsFixture("queued-writes-of-a-disposed-graph.mjs")).toEqual({
      stdout: `{"hostFilesWrittenTo":0}`,
      exitCode: 0,
    });
  });
  test("nor do writes the host had queued through FileHandles the graph opened", async () => {
    expect(await runsFixture("queued-writes-of-a-disposed-graph.mjs", "host")).toEqual({
      stdout: `{"hostFilesWrittenTo":0}`,
      exitCode: 0,
    });
  });
  test("nor do Bun.write()s the host had queued to those descriptors by number", async () => {
    expect(await runsFixture("queued-writes-of-a-disposed-graph.mjs", "host, through Bun.file(fd)")).toEqual({
      stdout: `{"hostFilesWrittenTo":0}`,
      exitCode: 0,
    });
  });
  test("the host's import() of a module parked in a top-level await is left pending: dispose() settles nothing", async () => {
    expect(await runsFixture("host-import-parked-at-dispose.mjs")).toEqual({
      stdout: `{"settled":"pending"}`,
      exitCode: 0,
    });
  });
  test("--hot: a server another graph's Bun.serve() took over is that graph's, and goes with it, not with the first", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--hot", join(dir, "taken-over-under-hot.mjs")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
      timeout: 30_000,
      killSignal: "SIGKILL",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect({ stdout: stdout.trim(), exitCode }).toEqual({
      stdout: `{"sameServer":true,"answers":["the second","the second","nobody"]}`,
      exitCode: 0,
    });
  });
  test("a node:net or node:http dial its leftover script makes does not go out, as a Bun.connect() does not", async () => {
    expect(await runsFixture("dials-after-it-was-disposed.mjs")).toEqual({
      stdout: `{"arrivedFromTheGraph":0}`,
      exitCode: 0,
    });
  });
  test("a global agent the host put in place of node's is what a graph's requests without an agent go through", async () => {
    expect(await runsFixture("host-replaced-the-global-agent.mjs")).toEqual({ stdout: `{"status":200}`, exitCode: 0 });
  });
  test.skipIf(isWindows)(
    "a child its leftover script spawns and writes to is not started: nothing fails, in it or in the host",
    async () => {
      expect(await runsFixture("spawns-after-it-was-disposed.mjs")).toEqual({
        stdout: `{"hostStillRuns":true}`,
        exitCode: 0,
      });
    },
  );
  test("a server it was disposed in the turn it listened is not announced to it: its listen callback cannot fail the host", async () => {
    expect(await runsFixture("disposed-in-the-turn-it-listens.mjs")).toEqual({ stdout: `{"heard":[]}`, exitCode: 0 });
  });
  test("a BroadcastChannel its leftover script makes and posts to says nothing, to it or to the host's listener", async () => {
    expect(await runsFixture("broadcast-channel-of-a-disposed-graph.mjs")).toEqual({
      stdout: `{"outcomes":["said nothing","said nothing"],"heardByTheHost":[]}`,
      exitCode: 0,
    });
  });
  test("what a module opens at its top level is the graph's when the graph loaded it through a graph of its own making", async () => {
    expect(await runsFixture("graph-made-by-a-graph.mjs")).toEqual({
      stdout: `{"evaluatedIn":"a graph's context","ticksAfterDispose":0}`,
      exitCode: 0,
    });
  });
  test("a graph it made is disposed with it: the host's import() through one it was handed rejects from then on", async () => {
    expect(await runsFixture("graph-handed-to-the-host.mjs")).toEqual({
      stdout: `{"inFlight":"pending","afterwards":"rejected: ERR_INVALID_STATE"}`,
      exitCode: 0,
    });
  });
  test("a server and a listener its script had stopped gracefully: what they left connected is closed", async () => {
    expect(await runsFixture("disposed-after-a-graceful-stop.mjs")).toEqual({
      stdout: `{"request":"ECONNRESET","client":"closed"}`,
      exitCode: 0,
    });
  });
  test("a Module its code makes with new Module() is the graph's: its globals, its require cache", async () => {
    expect(await runsFixture("modules-made-by-a-graph.mjs")).toEqual({
      stdout: `{"compiled":"the graph's","required":"the graph's","inTheHostsCache":false}`,
      exitCode: 0,
    });
  });
  test("a Bun.build it had under way: the plugin's callbacks are not called again", async () => {
    expect(await runsFixture("disposed-while-building.mjs")).toEqual({
      stdout: `{"stoppedShort":true,"calledAfterDispose":0}`,
      exitCode: 0,
    });
  });
  test("a Bun.build waiting for an answer its plugin will never give does not keep the process running", async () => {
    expect(await runsFixture("disposed-while-a-plugin-waits.mjs")).toEqual({ stdout: "idle", exitCode: 0 });
  });
  test("an S3 upload waiting for its script to write more does not keep the process running", async () => {
    expect(await runsFixture("disposed-while-uploading.mjs")).toEqual({ stdout: "idle", exitCode: 0 });
  });
  test("a Redis subscription does not keep the process running once its client cannot hear anything", async () => {
    expect({
      disposed: await runsFixture("subscribed-then-gone.mjs", "disposed"),
      closed: await runsFixture("subscribed-then-gone.mjs", "closed"),
    }).toEqual({ disposed: { stdout: "idle", exitCode: 0 }, closed: { stdout: "idle", exitCode: 0 } });
  });
  test("a performance observer and an HTTP/2 session it left behind do not keep it", async () => {
    expect(await runsFixture("dropped-after-observing-and-connecting.mjs")).toEqual({
      stdout: "collected",
      exitCode: 0,
    });
  });
  test("a server whose HTML routes were still being built is released with it", async () => {
    expect(await runsFixture("disposed-while-building-pages.mjs")).toEqual({ stdout: "collected", exitCode: 0 });
  });
  test("and the plugins those builds borrowed from it stay the server's", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(dir, "disposed-while-building-pages.mjs")],
      cwd: join(dir, "serve-plugin"),
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
      timeout: 30_000,
      killSignal: "SIGKILL",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    expect({ stdout: stdout.trim(), exitCode }).toEqual({ stdout: "collected", exitCode: 0 });
  });
  test.skipIf(isWindows)("file sinks, a child and a TLS handshake it left half done are dropped with it", async () => {
    expect(await runsFixture("disposed-with-things-half-done.mjs")).toEqual({
      stdout: `{"fileSinks":0,"childHeard":[],"tls":{"writes":[],"heard":[]}}`,
      exitCode: 0,
    });
  });
  test("bun test --isolate: a graph's fetch that completes after its file was retired does not keep that file's realm", async () => {
    using neverEnding = Bun.serve({
      port: 0,
      fetch: () =>
        new Response(
          new ReadableStream({ pull: controller => (controller.enqueue(new Uint8Array(1024)), new Promise(() => {})) }),
        ),
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--isolate", "first.test.js", "second.test.js"],
      cwd: join(dir, "isolated"),
      env: { ...bunEnv, NEVER_ENDING_URL: neverEnding.url.href },
      stdout: "pipe",
      stderr: "pipe",
      timeout: 30_000,
      killSignal: "SIGKILL",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ realms: (stdout + stderr).match(/realms: \d+/)?.[0], exitCode }).toEqual({
      realms: "realms: 1",
      exitCode: 0,
    });
  });
  test("a CommonJS wrapper made inside another function keeps that function's scope", async () => {
    expect(await runsFixture("custom-commonjs-wrapper.mjs")).toEqual({
      stdout: `["of the wrapper","undefined"]`,
      exitCode: 0,
    });
  });
  test("streams over its FileHandles that the host still holds do not touch whoever has the numbers now", async () => {
    expect(await runsFixture("host-holds-streams-over-file-handles.mjs")).toEqual({
      stdout: `{"sameNumbers":true,"read":"EBADF","wrote":"EBADF","hosts":"the host's"}`,
      exitCode: 0,
    });
  });
  test("its own leftover script is told nothing of them, and the host can still destroy them", async () => {
    expect(await runsFixture("its-own-streams-after-it-was-disposed.mjs")).toEqual({
      stdout: `{"told":{},"closed":true}`,
      exitCode: 0,
    });
  });
  test("a descriptor its script closed by number is not closed again under whoever has the number now", async () => {
    expect(await runsFixture("closes-a-descriptor-by-number.mjs")).toEqual({
      stdout: `{"sameNumber":true,"read":4}`,
      exitCode: 0,
    });
  });
  test("a CommonJS module that had not run yet when dispose() was called never does", async () => {
    expect(await runsFixture("disposed-before-its-commonjs-ran.mjs")).toEqual({
      stdout: `{"imported":"ERR_INVALID_STATE","told":[]}`,
      exitCode: 0,
    });
  });
  test("a Response whose body was still arriving: the host asking for it is told it failed, and nothing awaiting one is kept", async () => {
    expect(await runsFixture("response-bodies-of-disposed-graphs.mjs")).toEqual({
      stdout: `{"text":"rejected","protectedPromises":0}`,
      exitCode: 0,
    });
  });
  test.each(["by its script", "by a host function it called"])(
    "errors of a graph made in its context (%s) without an onError go to its onError, not to the host",
    async how => {
      expect(await runsFixture("errors-of-a-graph-made-by-a-graph.mjs", how)).toEqual({
        stdout: `{"hostSaw":[],"tenantSaw":["rejected and unhandled","thrown from a timer"]}`,
        exitCode: 0,
      });
    },
  );
  test("a rejection its onError causes in the code of a graph it made goes to the host, not back to that onError", async () => {
    expect(await runsFixture("on-error-that-causes-an-inner-rejection.mjs")).toEqual({
      stdout: `{"callsOfTheTenantsOnError":1,"hostSaw":["rejected by the inner graph's code"]}`,
      exitCode: 0,
    });
  });
  test("the files it held open are closed: a writer, bun:sqlite and node:sqlite databases, a FileHandle, a stream", async () => {
    expect(await runsFixture("open-files-of-a-disposed-graph.mjs")).toEqual({
      stdout: JSON.stringify({
        open: 5,
        hostUses: ["Database has closed", "Database has closed", "database is not open"],
      }),
      exitCode: 0,
    });
  });
  // (A disposed graph is told nothing, so its streams never get to close what they opened.)
  test.skipIf(isWindows)("the files its node:fs streams had open are closed", async () => {
    expect(await runsFixture("streams-of-a-disposed-graph.mjs")).toEqual({
      stdout: `{"open":32,"leftOpen":0}`,
      exitCode: 0,
    });
  });
  test.skipIf(isWindows)(
    "a FileHandle it forgot is closed by dispose(), and node:fs reports it to nobody",
    async () => {
      expect(await runsFixture("forgotten-file-handles.mjs", "disposed")).toEqual({
        stdout: `{"open":8,"leftOpenByDispose":0,"leftOpen":0,"host":["ERR_INVALID_STATE"],"graph":[]}`,
        exitCode: 0,
      });
    },
  );
  test.skipIf(isWindows)(
    "a FileHandle a live graph forgot is reported to that graph's onError, not to the host",
    async () => {
      expect(await runsFixture("forgotten-file-handles.mjs", "live")).toEqual({
        stdout: JSON.stringify({
          open: 8,
          leftOpenByDispose: 8,
          leftOpen: 0,
          host: ["ERR_INVALID_STATE"],
          graph: Array(8).fill("ERR_INVALID_STATE"),
        }),
        exitCode: 0,
      });
    },
  );
  test("a FileHandle and a stream of a disposed graph that the host still holds are closed, and never touch the descriptor's next owner", async () => {
    expect(await runsFixture("file-handle-the-host-holds.mjs")).toEqual({
      stdout: `{"fd":-1,"read":"EBADF","streamed":"EBADF","stillMine":[1,1]}`,
      exitCode: 0,
    });
  });
  test("crypto.subtle operations it had rejected early do not stop the host's later ones from settling", async () => {
    // (If they do, the host's await never finishes and the process exits with nothing printed.)
    expect(await runsFixture("subtle-after-a-disposed-graph.mjs")).toEqual({
      stdout: `{"rejectedInTheGraph":200,"settledInTheHost":2000}`,
      exitCode: 0,
    });
  });
  test("the promises of its crypto.subtle operations in flight are released, not kept unsettled", async () => {
    expect(await runsFixture("subtle-of-a-disposed-graph.mjs")).toEqual({
      stdout: `{"started":20,"kept":0} FormData`,
      exitCode: 0,
    });
  });
});

test("ModuleGraph isolation: every property of Bun is classified", () => {
  const classified: Record<string, "owned" | "job" | "pure" | "host"> = {
    $: "owned", // shell
    connect: "owned",
    listen: "owned",
    serve: "owned",
    udpSocket: "owned",
    spawn: "owned",
    Terminal: "owned", // module-graph-io: child processes
    fetch: "owned", // fetchInFlight
    sleep: "owned", // a timer
    RedisClient: "owned",
    redis: "owned",
    S3Client: "owned",
    s3: "owned",
    SQL: "owned", // module-graph-io: Bun.SQL pool
    sql: "owned",
    postgres: "owned",
    ModuleGraph: "owned", // nestedGraph: a graph made by a graph's code is stopped with it
    dns: "job",
    file: "job",
    write: "job",
    password: "job",
    zstdCompress: "job",
    zstdDecompress: "job",
    build: "job",
    Glob: "job",
    Transpiler: "job",
    Archive: "job",
    Image: "job",
    secrets: "job",
    resolve: "pure",
    // Process-wide by design.
    cron: "host", // registers with the operating system's scheduler
    plugin: "host",
    registerMacro: "host",
    stdin: "host",
    stdout: "host",
    stderr: "host",
    openInEditor: "host",
    WebView: "host",
    FFI: "host",
    jest: "host",
    unsafe: "host",
    gc: "host",
    generateHeapSnapshot: "host",
    shrink: "host",
    env: "host",
    argv: "host",
    main: "host",
    cwd: "host",
    embeddedFiles: "host",
    ...Object.fromEntries(
      [
        "ArrayBufferSink",
        "CSRF",
        "Cookie",
        "CookieMap",
        "CryptoHasher",
        "FileSystemRouter",
        "JSON5",
        "JSONC",
        "JSONL",
        "MD4",
        "MD5",
        "SHA1",
        "SHA224",
        "SHA256",
        "SHA384",
        "SHA512",
        "SHA512_256",
        "TOML",
        "XML",
        "YAML",
        "allocUnsafe",
        "color",
        "concatArrayBuffers",
        "deepEquals",
        "deepMatch",
        "deflateSync",
        "enableANSIColors",
        "escapeHTML",
        "fileURLToPath",
        "gunzipSync",
        "gzipSync",
        "hash",
        "indexOfLine",
        "inflateSync",
        "inspect",
        "isMainThread",
        "isStandaloneExecutable",
        "markdown",
        "mmap",
        "nanoseconds",
        "origin",
        "pathToFileURL",
        "peek",
        "randomUUIDv5",
        "randomUUIDv7",
        "readableStreamToArray",
        "readableStreamToArrayBuffer",
        "readableStreamToBlob",
        "readableStreamToBytes",
        "readableStreamToFormData",
        "readableStreamToJSON",
        "readableStreamToText",
        "resolveSync",
        "revision",
        "semver",
        "sha",
        "sleepSync",
        "sliceAnsi",
        "spawnSync",
        "stringWidth",
        "stripANSI",
        "version",
        "version_with_sha",
        "which",
        "wrapAnsi",
        "zstdCompressSync",
        "zstdDecompressSync",
      ].map(name => [name, "pure" as const]),
    ),
  };
  const unclassified = Object.getOwnPropertyNames(Bun).filter(name => !(name in classified));
  expect(unclassified).toEqual([]);
  // Every "owned" one that can be exercised offline has its kind in the matrix above.
  const kindOf: Record<string, string> = {
    $: "shell",
    connect: "connect",
    listen: "listen",
    serve: "serve",
    udpSocket: "udp",
    spawn: "spawn",
    fetch: "fetchInFlight",
    sleep: "interval",
    RedisClient: "redis",
    redis: "redis",
    S3Client: "s3",
    s3: "s3",
    ModuleGraph: "nestedGraph",
    SQL: "postgres", // and "mysql"
    sql: "postgres",
    postgres: "postgres",
  };
  const elsewhere = ["Terminal"]; // module-graph-io.test.ts
  const owned = Object.keys(classified).filter(name => classified[name] === "owned");
  expect(owned.filter(name => !elsewhere.includes(name) && !(kindOf[name] in kinds))).toEqual([]);
});

// The same forcing function for node: whoever adds a builtin module has to say here what a graph's
// dispose() does with what it opens. "owned": it opens things that outlive the call, and the kinds
// named for it are in the matrix above. "job": its work completes later, and the background-work
// test has entries whose names start with what is named for it. "pure" and "host" as for Bun.
test("ModuleGraph isolation: every node: builtin module is classified", () => {
  const owned = (...names: string[]) => ({ owned: names });
  const job = (...prefixes: string[]) => ({ job: prefixes });
  const http = owned("httpServer", "httpRequest");
  const tls = owned("tlsServer", "nodeTlsConnect");
  const classified: Record<string, "pure" | "host" | { owned: string[] } | { job: string[] }> = {
    _http_agent: http,
    _http_client: http,
    _http_common: http,
    _http_incoming: http,
    _http_outgoing: http,
    _http_server: http,
    http,
    https: owned("httpsServer"),
    http2: owned("http2Server", "http2Session"),
    net: owned("netServer", "netConnect", "netUnixServer", "netUnixConnect"),
    tls,
    _tls_common: tls,
    _tls_wrap: tls,
    dgram: owned("dgram"),
    child_process: owned("childProcessSpawn"),
    worker_threads: owned("worker"),
    timers: owned("interval", "immediateLoop"),
    "timers/promises": owned("timersPromisesInterval"),
    // Watchers are owned; everything else of fs is a job.
    fs: owned("watch", "watchFile"),
    "fs/promises": job("fs.promises."),
    undici: owned("fetchInFlight"),
    ws: owned("webSocket"),
    // dns.lookup is a job; a Resolver's queries have a test of their own (c-ares).
    dns: job("dns.lookup"),
    "dns/promises": job("dns.lookup"),
    crypto: job("crypto."),
    zlib: job("zlib."),
    // The `Bun` object: classified property by property above.
    bun: "pure",
    // Process-wide on purpose.
    cluster: "host", // forks the whole process
    inspector: "host",
    "inspector/promises": "host",
    process: "host",
    readline: "host", // process.stdin
    "readline/promises": "host",
    repl: "host",
    trace_events: "host",
    tty: "host",
    v8: "host",
    ...Object.fromEntries(
      [
        "_stream_duplex",
        "_stream_passthrough",
        "_stream_readable",
        "_stream_transform",
        "_stream_wrap",
        "_stream_writable",
        "assert",
        "assert/strict",
        "async_hooks",
        "buffer",
        "console",
        "constants",
        "diagnostics_channel",
        "domain",
        "events",
        "module",
        "node:sqlite",
        "os",
        "path",
        "path/posix",
        "path/win32",
        "perf_hooks",
        "punycode",
        "querystring",
        "stream",
        "stream/consumers",
        "stream/promises",
        "stream/web",
        "string_decoder",
        "sys",
        "url",
        "util",
        "util/types",
        "vm",
        "wasi",
      ].map(name => [name, "pure"] as const),
    ),
  };
  const modules = builtinModules.filter(name => !name.startsWith("bun:"));
  expect(modules.filter(name => !(name in classified))).toEqual([]);

  const missing: string[] = [];
  const backgroundNames = Object.keys(hostApp.background);
  for (const [name, how] of Object.entries(classified)) {
    if (typeof how === "string") continue;
    if ("owned" in how)
      missing.push(...how.owned.filter(kind => !(kind in kinds)).map(kind => name + ": kind " + kind));
    else
      missing.push(
        ...how.job
          .filter(prefix => !backgroundNames.some(entry => entry.startsWith(prefix)))
          .map(prefix => name + ": background " + prefix),
      );
  }
  expect(missing).toEqual([]);
});

test("ModuleGraph isolation: a Bun.$ script of a disposed graph stops: the running command is killed, later commands and builtins do not run, and its promise never settles", async () => {
  using a = await newGraph();
  using b = await newGraph();
  const [ofA, ofB] = [newState("shell-script-a"), newState("shell-script-b")];
  const pidOf = (file: string) => Number(existsSync(file) ? readFileSync(file, "utf8") : 0);
  const running = (file: string) => {
    const pid = pidOf(file);
    try {
      return pid > 0 && (process.kill(pid, 0), true);
    } catch {
      return false;
    }
  };
  try {
    a.graph.run(() => a.app.open.shellScript(ofA, bunExe()));
    b.graph.run(() => b.app.open.shellScript(ofB, bunExe()));
    // Both are on their second command (spawned from a process-exit callback, not from the graph's code).
    await until(() => running(ofA.file) && running(ofB.file));
    a.graph.dispose();
    await until(() => !running(ofA.file));
    // B's goes on when its long-running command ends; A's does not.
    process.kill(pidOf(ofB.file));
    await until(() => running(ofB.file + ".second"));
    expect({ a: existsSync(ofA.file + ".after"), b: existsSync(ofB.file + ".after") }).toEqual({ a: false, b: true });
    expect({ a: pidOf(ofA.file + ".second"), settled: ofA.settled }).toEqual({ a: 0, settled: undefined });
    b.graph.dispose();
    await until(() => !running(ofB.file + ".second"));
    expect(ofB.settled).toBeUndefined();
  } finally {
    for (const file of [ofA.file, ofA.file + ".second", ofB.file, ofB.file + ".second"]) {
      // (Never process.kill(0): that is this whole process group.)
      if (pidOf(file) > 0) {
        try {
          process.kill(pidOf(file));
        } catch {}
      }
    }
  }
});

// What a disposed graph started in the background never reports back: the promise its code is
// waiting on stays pending, so none of its code runs again.
test("ModuleGraph isolation: a DNS query (c-ares) of a disposed graph is never answered to it", async () => {
  // A DNS server of the host's that holds every query until told to answer (with NXDOMAIN).
  const held: { query: Buffer; port: number; address: string }[] = [];
  const server = await Bun.udpSocket({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      data(_socket, query, port, address) {
        held.push({ query: Buffer.from(query), port, address });
      },
      // The disposed graph's resolver has closed its socket: the answer to it is refused.
      error() {},
    },
  });
  const asked = (state: State) => held.some(({ query }) => query.toString("latin1").toLowerCase().includes(state.tag));
  const answerAll = () => {
    for (const { query, port, address } of held.splice(0)) {
      const reply = Buffer.from(query);
      reply[2] |= 0x80; // a response
      reply[3] = (reply[3] & 0xf0) | 3; // NXDOMAIN
      try {
        server.send(reply, port, address);
      } catch {
        // The refusal of the answer before this one, reported here: this one has not been sent yet.
        server.send(reply, port, address);
      }
    }
  };
  try {
    using disposed = await newGraph();
    using live = await newGraph();
    const states = {
      disposed: newState("resolve-disposed"),
      live: newState("resolve-live"),
      host: newState("resolve-host"),
    };
    disposed.graph.run(() => disposed.app.resolveThrough(states.disposed, server.port));
    live.graph.run(() => live.app.resolveThrough(states.live, server.port));
    hostApp.resolveThrough(states.host, server.port);
    await until(() => Object.values(states).every(asked));

    disposed.graph.dispose();
    answerAll();
    await until(() => states.live.settled !== undefined && states.host.settled !== undefined);
    await hostTimerTurns();
    expect({
      disposed: states.disposed.settled,
      live: states.live.settled,
      host: states.host.settled,
    }).toEqual({ disposed: undefined, live: "ENOTFOUND", host: "ENOTFOUND" });
  } finally {
    server.close();
  }
});

test("ModuleGraph isolation: background work of a disposed graph does not settle into it", async () => {
  using made = await newGraph();
  const names = Object.keys(hostApp.background);
  const started: Record<string, Promise<unknown>> = {};
  made.graph.run(() => {
    for (const name of names) (started[name] = Promise.resolve(made.app.background[name]())).catch(() => {});
  });
  // What finished inside the call that started it is not something the event loop delivers.
  const pending = names.filter(name => Bun.peek.status(started[name]) === "pending");
  made.graph.dispose();
  // The same work in the host, started afterwards, has all finished: the graph's would have too.
  await Promise.all(names.map(name => Promise.resolve(hostApp.background[name]()).catch(() => {})));
  await hostTimerTurns();
  const settled = pending.filter(name => Bun.peek.status(started[name]) !== "pending");
  expect(settled.filter(name => !mayStillSettle.includes(name))).toEqual([]);
});

// Work that finishes inside the call that starts it, or through microtasks that were queued by the time
// the graph was disposed: what a graph had queued still runs. Which of these a platform's backend
// completes this way varies; none other may settle.
const mayStillSettle = [
  "Bun.file().stream()",
  "fetch(data:)",
  "fetch(blob:)",
  "CompressionStream",
  // Computed inside the call; the callback is a process.nextTick.
  "crypto.randomInt",
  // A file sink's writes complete inside write() on POSIX, from the event loop on Windows.
  ...(isWindows ? [] : ["Bun.file().writer(): write, end", "Bun.spawn stdin: write, end"]),
];

describe.concurrent(
  "ModuleGraph isolation: background work under way when its graph is disposed does not settle into it",
  () => {
    // Disposed from the handler of the first one to settle: the others are under way, or finished
    // and queued behind it, whatever the speed of the build. (The same-turn dispose() of the test
    // above never gets past the first step of work that takes several.)
    for (const name of Object.keys(hostApp.background)) {
      test(name, async () => {
        using made = await newGraph();
        const state = newState("race") as ReturnType<typeof newState> & { settledAtDispose?: number };
        made.graph.run(() => made.app.race(name, 8, state, () => made.graph.dispose()));
        await until(() => state.ticks > 0);
        // The same work in the host, started afterwards, has all finished: the graph's had too.
        const hostState = newState("race-host");
        hostApp.race(name, 8, hostState, () => {});
        await until(() => hostState.ticks === 8);
        await hostTimerTurns();
        const expected = mayStillSettle.includes(name) ? expect.any(Number) : state.settledAtDispose;
        expect({ settled: state.ticks }).toEqual({ settled: expected });
      });
    }
  },
);

test("ModuleGraph isolation: a native fs.cp in flight does not settle into a disposed graph", async () => {
  const from = join(dir, "cp-source.bin");
  writeFileSync(from, Buffer.alloc(1 << 20, 1));
  using made = await newGraph();
  const state = newState("cp");
  // Disposed from the first copy's own handler: the other 31 are under way, or finished and
  // queued behind it, whatever the speed of the build and the disk.
  made.graph.run(() => made.app.copies(from, join(dir, "cp-of-the-graph"), 16, state, () => made.graph.dispose()));
  await until(() => state.ticks > 0);
  // The same copies, asked for afterwards by the host, have all finished: the graph's had too.
  const hostState = newState("cp-host");
  hostApp.copies(from, join(dir, "cp-of-the-host"), 16, hostState, () => {});
  await until(() => hostState.ticks === 32);
  await hostTimerTurns();
  expect(state.ticks).toBe(1);
});

test("ModuleGraph isolation: work that continues from one thread-pool step to the next stays the graph's: disposing it mid-way ends the chain", async () => {
  // 48 MB of a repeated block: a few hundred KB compressed, well over a hundred steps to decode.
  const gzipped = Bun.gzipSync(Buffer.alloc(48 << 20, crypto.getRandomValues(new Uint8Array(1024))));
  using made = await newGraph();
  const [ofGraph, ofHost] = [newState("decompress-graph"), newState("decompress-host")];
  const inGraph: Promise<ArrayBuffer> = made.graph.run(() => made.app.decompressALot(ofGraph, gzipped));
  // Some steps in, not all.
  await until(() => ofGraph.ticks > 2);
  made.graph.dispose();
  const stoppedAt = ofGraph.ticks;
  // The host's, started afterwards, runs to the end.
  await hostApp.decompressALot(ofHost, gzipped);
  await hostTimerTurns();
  expect({ status: Bun.peek.status(inGraph), steps: ofGraph.ticks, hostSteps: ofHost.ticks > stoppedAt }).toEqual({
    status: "pending",
    steps: stoppedAt,
    hostSteps: true,
  });
});

test("ModuleGraph isolation: a multipart S3 upload is its graph's from the first request to the last: disposing the graph mid-way sends no later part and no completion and rolls the upload back, and another graph's upload completes", async () => {
  // A minimal S3: which requests each key (the state's tag) has made. Part 2 of the upload that gets
  // disposed is held until the test lets it go, and so is the completion of the one that gets
  // disposed while completing.
  const requests: Record<string, string[]> = {};
  const inFlight = Promise.withResolvers<void>();
  const letGo = Promise.withResolvers<void>();
  const completing = Promise.withResolvers<void>();
  const letComplete = Promise.withResolvers<void>();
  using s3 = Bun.serve({
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const key = url.pathname.split("/").pop()!;
      const log = (requests[key] ??= []);
      const xml = (body: string) => new Response(body, { headers: { "content-type": "application/xml" } });
      if (request.method === "POST" && url.searchParams.has("uploads")) {
        log.push("create");
        return xml(
          `<InitiateMultipartUploadResult><Bucket>bucket</Bucket><Key>${key}</Key><UploadId>upload-${key}</UploadId></InitiateMultipartUploadResult>`,
        );
      }
      if (request.method === "PUT" && url.searchParams.has("partNumber")) {
        const part = url.searchParams.get("partNumber");
        await request.arrayBuffer();
        log.push("part " + part);
        if (key === "upload-disposed" && part === "2") {
          inFlight.resolve();
          await letGo.promise;
        }
        return new Response("", { headers: { etag: `"etag-${part}"` } });
      }
      if (request.method === "POST" && url.searchParams.has("uploadId")) {
        log.push("complete");
        if (key === "upload-completing") {
          completing.resolve();
          await letComplete.promise;
        }
        return xml(
          `<CompleteMultipartUploadResult><Bucket>bucket</Bucket><Key>${key}</Key><ETag>"done"</ETag></CompleteMultipartUploadResult>`,
        );
      }
      if (request.method === "DELETE") {
        log.push("abort");
        return new Response(null, { status: 204 });
      }
      log.push(request.method + " " + url.search);
      return new Response("unexpected", { status: 400 });
    },
  });
  using disposed = await newGraph();
  using kept = await newGraph();
  using disposedCompleting = await newGraph();
  const [ofDisposed, ofKept, ofCompleting] = [
    newState("upload-disposed"),
    newState("upload-kept"),
    newState("upload-completing"),
  ];
  const endpoint = `http://127.0.0.1:${s3.port}`;
  disposed.graph.run(() => disposed.app.uploadInParts(ofDisposed, endpoint));
  const keptUpload: Promise<void> = kept.graph.run(() => kept.app.uploadInParts(ofKept, endpoint));
  disposedCompleting.graph.run(() => disposedCompleting.app.uploadInParts(ofCompleting, endpoint));
  await inFlight.promise;
  disposed.graph.dispose();
  letGo.resolve();
  await completing.promise;
  disposedCompleting.graph.dispose();
  letComplete.resolve();
  await keptUpload;
  // The part in flight is aborted, and its script hears nothing of it. (The kept upload's two
  // later parts and its completion went out after that part was let go.)
  await hostTimerTurns();
  expect({ settled: ofKept.settled, requests: requests[ofKept.tag] }).toEqual({
    settled: "uploaded",
    requests: ["create", "part 1", "part 2", "part 3", "part 4", "complete"],
  });
  // No later part and no completion is sent. The upload is rolled back, so that the store keeps
  // no orphaned parts (which are billed until they expire): that request is not the script's.
  await until(() => requests[ofDisposed.tag].includes("abort"));
  expect({ settled: ofDisposed.settled, requests: requests[ofDisposed.tag] }).toEqual({
    settled: undefined,
    requests: ["create", "part 1", "part 2", "abort"],
  });
  // Disposed while the completion was on its way: whether the store got it is not known, so it is
  // rolled back too (a store that did complete it has nothing left to drop).
  await until(() => requests[ofCompleting.tag].includes("abort"));
  expect({ settled: ofCompleting.settled, requests: requests[ofCompleting.tag] }).toEqual({
    settled: undefined,
    requests: ["create", "part 1", "part 2", "part 3", "part 4", "complete", "abort"],
  });
});
