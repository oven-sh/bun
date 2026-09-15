// Bun.ModuleGraph({ isolateIO: true }): graphs are isolated from each other and from the
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
      const graph = new Bun.ModuleGraph({ isolateIO: true });
      const app = await graph.import(import.meta.dir + "/app.mjs");
      const state = { ticks: 0 };
      let hostTurns = 0;
      setInterval(() => hostTurns++, 1);
      const hostTurnsPass = async turns => { for (const from = hostTurns; hostTurns < from + turns; ) await new Promise(resolve => setImmediate(resolve)); };
      graph.run(() => app.retryForever(name, state, ports));
      await hostTurnsPass(10);
      writeSync(1, "armed\\n");
      graph.dispose();
      // What was under way may still report once (however late), and its continuation starts one
      // more step, which reports nothing. A loop that sustains itself never goes quiet.
      let quiet = false;
      for (let window = 0; window < 40 && !quiet; window++) {
        const before = state.ticks;
        await hostTurnsPass(50);
        quiet = state.ticks === before;
      }
      writeSync(1, quiet ? "stops\\n" : "keeps running\\n");
      process.exit(0);
    `,
    "opens-then-disposes.mjs": `
      const [kind, state, args] = [process.argv[2], JSON.parse(process.argv[3]), JSON.parse(process.argv[4])];
      const graph = new Bun.ModuleGraph({ isolateIO: true });
      const app = await graph.import(import.meta.dir + "/app.mjs");
      await graph.run(() => app.open[kind](state, ...args));
      graph.dispose();
      console.log("disposed");
      // Does not keep the process running; says so if something else does.
      setTimeout(() => { console.log("and the process is still running"); process.exit(1); }, 3000).unref();
    `,
    // What a disposed graph left in something of the realm's. Each in a process of its own: they count objects.
    "left-behind-tenant.mjs": `
      import fs from "node:fs";
      import { PerformanceObserver } from "node:perf_hooks";
      export const observeHttp = () => new PerformanceObserver(() => {}).observe({ entryTypes: ["http"] });
      // Each promise's reaction holds a FormData: alive for as long as the promise is kept.
      export const opens = (path, count) => { for (let i = 0; i < count; i++) fs.promises.open(path, "r").then(handle => handle.close(), () => {}); };
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
      const graph = new Bun.ModuleGraph({ isolateIO: true });
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
      const graph = new Bun.ModuleGraph({ isolateIO: true });
      const app = await graph.import(import.meta.dir + "/left-behind-tenant.mjs");
      const before = descriptors();
      graph.run(() => app.opens(import.meta.path, 64));
      graph.dispose();
      // The same work asked for afterwards has finished: the graph's had too.
      await Promise.all(Array.from({ length: 64 }, () => fs.promises.open(import.meta.path, "r").then(handle => handle.close())));
      await new Promise(resolve => setImmediate(resolve));
      console.log(JSON.stringify({ leftOpen: descriptors() - before }));
    `,
    "subtle-of-a-disposed-graph.mjs": `
      import { heapStats } from "bun:jsc";
      const count = () => heapStats().objectTypeCounts.FormData;
      const keep = new FormData(), baseline = count();
      const graph = new Bun.ModuleGraph({ isolateIO: true });
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
    "disposes-then-opens.mjs": `
      const [kind, state, args] = [process.argv[2], JSON.parse(process.argv[3]), JSON.parse(process.argv[4])];
      const graph = new Bun.ModuleGraph({ isolateIO: true });
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
          const inner = new Bun.ModuleGraph({ isolateIO: true, globals: { state } });
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
        "Bun.write(file, file)": () => Bun.write(dataFile + ".copy", Bun.file(dataFile)),
        "MessageChannel": () => new Promise(resolve => { const { port1, port2 } = new MessageChannel(); port1.onmessage = () => { port1.close(); resolve(); }; port2.postMessage(1); }),
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
  const graph = new ModuleGraph({ isolateIO: true, ...options });
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
  test("a keep-alive http.Agent of the host's: a request the host queued behind the graph's is served after dispose()", async () => {
    // One socket: the host's request waits for the graph's, which is in flight when the graph is disposed.
    const agent = new http.Agent({ keepAlive: true, maxSockets: 1 });
    try {
      using made = await newGraph();
      made.graph.run(() => made.app.getThrough(agent, hostHttp.port, "/hang?tag=agent-of-the-host")).catch(() => {});
      await until(() => connected.has("http:agent-of-the-host"));
      const hosts = hostApp.getThrough(agent, hostHttp.port, "/release?tag=nobody");
      made.graph.dispose();
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

  test("dispose() from inside the graph's own close handler is a no-op, and the host can still use what it holds", async () => {
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
              graph.dispose();
            },
          },
        }),
      ),
    );
    const held = { ...state, port: server.port, tag: "held" };
    graph.dispose();
    await until(() => state.heard.length > 0);
    expect(state.heard).toEqual(["close"]);
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
      first.graph.dispose();
      using second = await newGraph();
      const steps = allHops.length * 3;
      await start(second, fresh, { steps });
      expect({ ticks: fresh.ticks, wrong: fresh.wrong }).toEqual({ ticks: steps, wrong: [] });
      const stoppedAt = old.ticks;
      // The disposed graph's functions are still functions: called by the host they run as the host's
      // code; entered through run() what they open is closed at once.
      first.app.open.interval(viaHost);
      first.graph.run(() => first.app.open.interval(viaRun));
      expect([await ticks(viaHost), await ticks(viaRun)]).toEqual([true, false]);
      expect(old.ticks).toBe(stoppedAt);
    } finally {
      old.stop = true;
      viaHost.close?.();
    }
  });
});

describe.concurrent("ModuleGraph isolation: what a disposed graph had open does not keep the process running", () => {
  for (const kind of Object.keys(kinds)) {
    test(kind, async () => {
      const state = newState(kind + "-exits");
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          join(dir, "opens-then-disposes.mjs"),
          kind,
          JSON.stringify(state),
          JSON.stringify(kinds[kind].args?.(state) ?? []),
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "inherit",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect(stdout).toBe("disposed\n");
      expect(exitCode).toBe(0);
    });
  }
});

describe.concurrent("ModuleGraph isolation: what a disposed graph opens does not keep the process running", () => {
  for (const kind of Object.keys(kinds)) {
    test(kind, async () => {
      const state = newState(kind + "-late-exits");
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          join(dir, "disposes-then-opens.mjs"),
          kind,
          JSON.stringify(state),
          JSON.stringify(kinds[kind].args?.(state) ?? []),
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "inherit",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect(stdout).toBe("disposed\n");
      expect(exitCode).toBe(0);
    });
  }
});

describe.concurrent("ModuleGraph isolation: a disposed graph cannot keep itself running", () => {
  // What was open at dispose() may tell the graph once that it closed, and that handler may start
  // the next thing. If that one reported back too, a loop that retries on failure would go on for
  // ever inside a disposed graph (and a spawn loop would go on launching processes).
  for (const name of Object.keys(hostApp.steps)) {
    test(name, async () => {
      await using proc = Bun.spawn({
        cmd: [
          bunExe(),
          join(dir, "retries-then-is-disposed.mjs"),
          name,
          JSON.stringify({ http: hostHttp.port, tcp: hostTcp.port }),
        ],
        env: bunEnv,
        stdout: "pipe",
        stderr: "inherit",
        timeout: 4_000,
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      expect(stdout).toBe("armed\nstops\n");
      expect(exitCode).toBe(0);
    });
  }
});

// A forcing function: whoever adds something to `Bun` has to say here what a graph's dispose() does
// with it. "owned": something it opens outlives the call and a test above (or in
// module-graph-io.test.ts) shows dispose() closing it. "job": its work runs on a thread pool; the
// "background work" test says which completions are dropped once the graph is disposed. "pure": nothing
// outlives the call. "host": process-wide on purpose (the graph's host decides who may use it).
describe.concurrent("ModuleGraph isolation: a disposed graph leaves nothing behind in what is the realm's", () => {
  const runs = async (script: string, ...args: string[]) => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(dir, script), ...args],
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
    return { stdout: stdout.trim(), exitCode };
  };
  test("its node:perf_hooks observer is disconnected: the host's requests are not buffered for it", async () => {
    const [observed, control] = await Promise.all(
      ["observe", "control"].map(async mode => {
        const { stdout, exitCode } = await runs("observer-of-a-disposed-graph.mjs", mode);
        return { ...(JSON.parse(stdout) as { requests: number; kept: number }), exitCode };
      }),
    );
    // An entry buffered for the observer is a dozen objects: kept for every request, that is
    // twelve times `requests` more than the control keeps.
    expect({
      more: observed.kept - control.kept < observed.requests,
      exitCodes: [observed.exitCode, control.exitCode],
    }).toEqual({
      more: true,
      exitCodes: [0, 0],
    });
  });
  // (Counts the process's descriptors through /proc/self/fd or /dev/fd.)
  test.skipIf(isWindows)("the files its fs.promises.open() calls in flight opened are closed", async () => {
    expect(await runs("files-of-a-disposed-graph.mjs")).toEqual({ stdout: `{"leftOpen":0}`, exitCode: 0 });
  });
  test("the promises of its crypto.subtle operations in flight are released, not kept unsettled", async () => {
    expect(await runs("subtle-of-a-disposed-graph.mjs")).toEqual({
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
  // Completions that do not know which graph started them still resolve their promise, so the graph's
  // continuation runs (in its stopped context: what it opens is closed at once). Which of these a
  // platform's backend delivers this way varies; none other may.
  const mayStillSettle = [
    "Bun.file().stream()",
    "fetch(data:)",
    "fetch(blob:)",
    "CompressionStream",
    // Computed inside the call; the callback is a process.nextTick, and what a graph had queued still runs.
    "crypto.randomInt",
  ];
  // The exit of a child the graph started is a close notification: its code hears of it.
  const mustSettle = ["child_process.exec", "Bun.spawn().exited"];

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
  await until(() => mustSettle.every(name => Bun.peek.status(started[name]) !== "pending"));
  await hostTimerTurns();
  const settled = pending.filter(name => Bun.peek.status(started[name]) !== "pending");
  expect(settled.filter(name => !mayStillSettle.includes(name))).toEqual(mustSettle);
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

test("ModuleGraph isolation: a multipart S3 upload is its graph's from the first request to the last: disposing the graph mid-way sends no later part and no completion, and another graph's upload completes", async () => {
  // A minimal S3: which requests each key (the state's tag) has made. Part 2 of the upload that gets
  // disposed is held until the test lets it go.
  const requests: Record<string, string[]> = {};
  const inFlight = Promise.withResolvers<void>();
  const letGo = Promise.withResolvers<void>();
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
  const [ofDisposed, ofKept] = [newState("upload-disposed"), newState("upload-kept")];
  const endpoint = `http://127.0.0.1:${s3.port}`;
  disposed.graph.run(() => disposed.app.uploadInParts(ofDisposed, endpoint));
  const keptUpload: Promise<void> = kept.graph.run(() => kept.app.uploadInParts(ofKept, endpoint));
  await inFlight.promise;
  disposed.graph.dispose();
  letGo.resolve();
  await keptUpload;
  // The part in flight fails and its script hears, as with an aborted fetch.
  await until(() => ofDisposed.settled);
  await hostTimerTurns();
  expect({ settled: ofKept.settled, requests: requests[ofKept.tag] }).toEqual({
    settled: "uploaded",
    requests: ["create", "part 1", "part 2", "part 3", "part 4", "complete"],
  });
  // No later part and no completion is sent. The upload's own rollback (so the store keeps no
  // orphaned parts) may be.
  expect({
    settled: ofDisposed.settled,
    requests: requests[ofDisposed.tag].filter(request => request !== "abort"),
  }).toEqual({ settled: expect.stringMatching(/^Aborted/), requests: ["create", "part 1", "part 2"] });
});
