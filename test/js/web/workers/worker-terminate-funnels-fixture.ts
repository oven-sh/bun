// Host for worker-terminate-funnels.test.ts. Runs one family of entries: for each
// (entry, phase) it starts a worker that arms one native→JS entry point, and the
// parent terminates the worker at a fixed point relative to that entry point:
//
//   armed  – the callback is armed but cannot have fired (its trigger is withheld)
//   inside – the callback signals and parks on a shared cell; the parent
//            terminates, then releases it, so the stop is requested while JS is
//            inside that callback and takes effect at its next safepoint
//   after  – the callback re-arms the same operation, the parent supplies the
//            trigger for it and terminates: the follow-on completion is in
//            flight when the worker stops
//
// Every case must end with 'exit' and nothing else. Prints "ok <cases>".
import { Worker } from "node:worker_threads";
import net from "node:net";
import dgram from "node:dgram";

type Phase = "armed" | "inside" | "after";
type Handle = { params?: any; onSignal?: () => void | Promise<void>; close?: () => void };
type Entry = {
  name: string;
  phases: Phase[];
  // Body of the worker. Has `phase`, `params`, `armed()`, `hit(rearm?)` in scope.
  worker: string;
  // Parent-side peer for this case (a server to connect to, a port to post to…).
  host?: (phase: Phase, worker: () => Worker) => Handle | Promise<Handle>;
};

const ALL: Phase[] = ["armed", "inside", "after"];

const PRELUDE = `
  const { workerData, parentPort } = require("node:worker_threads");
  const { ctl, phase, params } = workerData;
  function signal() { Atomics.store(ctl, 0, 1); Atomics.notify(ctl, 0); }
  // Once the entry point is armed (and, for "armed", cannot fire).
  function armed() { if (phase === "armed") signal(); }
  // First line of the entry point's callback.
  function hit(rearm) {
    if (phase === "inside") { signal(); Atomics.wait(ctl, 1, 0); }
    else if (phase === "after") { if (rearm) rearm(); signal(); }
  }
`;

const FAMILIES: Record<string, Entry[]> = {
  timers: [
    {
      name: "setTimeout",
      phases: ALL,
      worker: `setTimeout(() => hit(() => setTimeout(() => {}, 0)), phase === "armed" ? 1e8 : 0); armed();`,
    },
    {
      name: "setInterval",
      phases: ALL,
      worker: `let n = 0; const t = setInterval(() => { if (n++ === 0) hit(); }, phase === "armed" ? 1e8 : 1); armed();`,
    },
    {
      name: "setImmediate",
      phases: ["inside", "after"],
      worker: `setImmediate(() => hit(() => setImmediate(() => {})));`,
    },
    {
      name: "promise reaction",
      phases: ["inside", "after"],
      worker: `Promise.resolve().then(() => hit(() => Promise.resolve().then(() => {})));`,
    },
    {
      name: "process.nextTick",
      phases: ["inside", "after"],
      worker: `process.nextTick(() => hit(() => process.nextTick(() => {})));`,
    },
    // The timeout's own timer is unref'd (as in Node); the port listener keeps the worker up until it fires.
    {
      name: "AbortSignal.timeout",
      phases: ALL,
      worker: `parentPort.on("message", () => {}); AbortSignal.timeout(phase === "armed" ? 1e8 : 1).addEventListener("abort", () => hit()); armed();`,
    },
    { name: "keep-alive only", phases: ["armed"], worker: `parentPort.on("message", () => {}); armed();` },
  ],

  messaging: [
    {
      name: "parentPort message",
      phases: ALL,
      worker: `parentPort.on("message", () => hit()); armed(); if (phase !== "armed") parentPort.postMessage("ready");`,
      host: (phase, worker) => ({
        // Deliver only once the listener exists; for "after", a second message is in flight at stop.
        params: undefined,
        onSignal: () => {
          if (phase === "after") worker().postMessage(2);
        },
      }),
    },
    {
      name: "MessageChannel delivery",
      phases: ALL,
      worker: `
        const { port1, port2 } = new MessageChannel();
        port1.on("message", () => hit(() => port2.postMessage(2)));
        armed();
        if (phase !== "armed") port2.postMessage(1);
      `,
    },
    {
      name: "transferred port delivery",
      phases: ALL,
      worker: `
        params.port.on("message", () => hit());
        params.port.postMessage("sub");   // tells the parent the listener exists
        armed();
      `,
      host: phase => {
        const { port1, port2 } = new MessageChannel();
        port1.on("message", () => {
          if (phase !== "armed") port1.postMessage(1);
        });
        return {
          params: { port: port2 },
          transfer: [port2],
          onSignal: () => {
            if (phase === "after") port1.postMessage(2);
          },
          close: () => port1.close(),
        } as any;
      },
    },
    {
      name: "BroadcastChannel delivery",
      phases: ALL,
      worker: `
        const bc = new BroadcastChannel(params.name);
        bc.onmessage = () => hit();
        armed();
        if (phase !== "armed") new BroadcastChannel(params.name + "-w").postMessage("sub");
      `,
      host: phase => {
        const name = "wtf-" + Math.random().toString(36).slice(2);
        const bc = new BroadcastChannel(name);
        const sub = new BroadcastChannel(name + "-w");
        sub.onmessage = () => bc.postMessage(1);
        return {
          params: { name },
          onSignal: () => {
            if (phase === "after") bc.postMessage(2);
          },
          close: () => {
            bc.close();
            sub.close();
          },
        };
      },
    },
    {
      name: "messages posted before natural exit",
      phases: ["armed"],
      // Not terminated: the worker floods and exits by itself; the parent must get every message then 'exit'.
      worker: `for (let i = 0; i < 3000; i++) parentPort.postMessage(i);`,
      host: () => ({ natural: 3000 }) as any,
    },
  ],

  net: [
    {
      name: "net.Socket data",
      phases: ALL,
      worker: `
        const s = require("node:net").connect(params.port, "127.0.0.1");
        s.on("data", () => hit());
        s.on("error", () => {});
        s.on("connect", () => armed());
      `,
      host: phase => tcpPeer(phase, { writeOnOpen: phase !== "armed", writeOnSignal: phase === "after" }),
    },
    {
      name: "net.Socket end",
      phases: ["armed", "inside"],
      worker: `
        const s = require("node:net").connect(params.port, "127.0.0.1");
        s.on("data", () => {}); s.on("end", () => hit()); s.on("error", () => {});
        s.on("connect", () => armed());
      `,
      host: phase => tcpPeer(phase, { endOnOpen: phase !== "armed" }),
    },
    {
      name: "net.Server connection",
      phases: ALL,
      worker: `
        const srv = require("node:net").createServer(c => { hit(); c.destroy(); });
        srv.listen(0, "127.0.0.1", () => { parentPort.postMessage(srv.address().port); armed(); });
      `,
      host: (phase, worker) => {
        let port = 0;
        const connect = () => {
          const c = net.connect(port, "127.0.0.1");
          c.on("error", () => {});
          c.on("connect", () => c.end());
        };
        return {
          onPort: (p: number) => {
            port = p;
            if (phase !== "armed") connect();
          },
          onSignal: () => {
            if (phase === "after") connect();
          },
        } as any;
      },
    },
    {
      name: "Bun.connect data",
      phases: ALL,
      worker: `
        Bun.connect({ hostname: "127.0.0.1", port: params.port, socket: {
          open() { armed(); }, data() { hit(); }, error() {}, close() {},
        }}).catch(() => {});
      `,
      host: phase => tcpPeer(phase, { writeOnOpen: phase !== "armed", writeOnSignal: phase === "after" }),
    },
    {
      name: "Bun.listen open",
      phases: ALL,
      worker: `
        const l = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { open(s) { hit(); s.end(); }, data() {}, error() {} } });
        parentPort.postMessage(l.port); armed();
      `,
      host: phase => {
        let port = 0;
        const connect = () => {
          const c = net.connect(port, "127.0.0.1");
          c.on("error", () => {});
          c.on("connect", () => c.end());
        };
        return {
          onPort: (p: number) => {
            port = p;
            if (phase !== "armed") connect();
          },
          onSignal: () => {
            if (phase === "after") connect();
          },
        } as any;
      },
    },
    {
      name: "dgram message",
      phases: ALL,
      worker: `
        const s = require("node:dgram").createSocket("udp4");
        s.on("message", () => hit());
        s.bind(0, "127.0.0.1", () => { parentPort.postMessage(s.address().port); armed(); });
      `,
      host: phase => {
        const c = dgram.createSocket("udp4");
        let port = 0;
        return {
          onPort: (p: number) => {
            port = p;
            if (phase !== "armed") c.send("x", port, "127.0.0.1");
          },
          onSignal: () => {
            if (phase === "after") c.send("y", port, "127.0.0.1");
          },
          close: () => c.close(),
        } as any;
      },
    },
  ],

  http: [
    {
      name: "http.Server request",
      phases: ALL,
      worker: `
        const srv = require("node:http").createServer((req, res) => { hit(); res.end("x"); });
        srv.listen(0, "127.0.0.1", () => { parentPort.postMessage(srv.address().port); armed(); });
      `,
      host: phase => {
        let port = 0;
        const get = () =>
          fetch("http://127.0.0.1:" + port)
            .then(r => r.text())
            .catch(() => {});
        return {
          onPort: (p: number) => {
            port = p;
            if (phase !== "armed") get();
          },
          onSignal: () => {
            if (phase === "after") get();
          },
        } as any;
      },
    },
    {
      name: "http.ClientRequest response data",
      phases: ALL,
      worker: `
        require("node:http").get("http://127.0.0.1:" + params.port + "/" + phase, res => { res.on("data", () => hit()); res.on("error", () => {}); })
          .on("error", () => {}).on("socket", () => armed());
      `,
      host: phase => httpPeer(phase),
    },
    {
      name: "fetch settle + body pull",
      phases: ALL,
      worker: `
        fetch("http://127.0.0.1:" + params.port + "/" + phase).then(async r => {
          const reader = r.body.getReader();
          hit(() => reader.read().catch(() => {}));
          await reader.read().catch(() => {});
        }).catch(() => {});
        armed();
      `,
      host: phase => httpPeer(phase),
    },
    {
      name: "Bun.serve fetch handler",
      phases: ALL,
      worker: `
        const srv = Bun.serve({ port: 0, hostname: "127.0.0.1", development: false, fetch() { hit(); return new Response("x"); } });
        parentPort.postMessage(srv.port); armed();
      `,
      host: phase => {
        let port = 0;
        const get = () =>
          fetch("http://127.0.0.1:" + port)
            .then(r => r.text())
            .catch(() => {});
        return {
          onPort: (p: number) => {
            port = p;
            if (phase !== "armed") get();
          },
          onSignal: () => {
            if (phase === "after") get();
          },
        } as any;
      },
    },
    {
      name: "WebSocket client message",
      phases: ALL,
      worker: `
        const ws = new WebSocket("ws://127.0.0.1:" + params.port + "/" + phase);
        ws.onopen = () => armed();
        ws.onmessage = () => hit(() => ws.send("more"));
        ws.onerror = () => {};
      `,
      host: async phase => {
        const srv = Bun.serve({
          port: 0,
          hostname: "127.0.0.1",
          development: false,
          fetch(req, s) {
            return s.upgrade(req) ? undefined : new Response("no");
          },
          websocket: {
            open(ws) {
              if (phase !== "armed") ws.send("x");
            },
            message(ws) {
              ws.send("y");
            },
          },
        });
        return { params: { port: srv.port }, close: () => srv.stop(true) };
      },
    },
    {
      name: "ServerWebSocket message",
      phases: ALL,
      worker: `
        const srv = Bun.serve({ port: 0, hostname: "127.0.0.1", development: false,
          fetch(req, s) { return s.upgrade(req) ? undefined : new Response("no"); },
          websocket: { open() { armed(); }, message(ws) { hit(); ws.send("y"); } } });
        parentPort.postMessage(srv.port);
      `,
      host: phase => {
        let ws: WebSocket | undefined;
        return {
          onPort: (p: number) => {
            ws = new WebSocket("ws://127.0.0.1:" + p);
            ws.onerror = () => {};
            ws.onopen = () => {
              if (phase !== "armed") ws!.send("x");
            };
          },
          onSignal: () => {
            if (phase === "after") ws?.send("z");
          },
          close: () => ws?.close(),
        } as any;
      },
    },
  ],

  fs: [
    {
      name: "fs.readFile",
      phases: ["inside", "after"],
      worker: `const fs = require("node:fs"); fs.readFile(process.execPath, () => hit(() => fs.readFile(process.execPath, () => {})));`,
    },
    {
      name: "fs.promises.stat",
      phases: ["inside", "after"],
      worker: `const fs = require("node:fs"); fs.promises.stat(process.execPath).then(() => hit(() => fs.promises.stat(process.execPath)));`,
    },
    {
      name: "fs.createReadStream data",
      phases: ["inside", "after"],
      worker: `const rs = require("node:fs").createReadStream(process.execPath, { highWaterMark: 1 << 16 }); rs.on("data", () => hit()); rs.on("error", () => {});`,
    },
    {
      name: "fs.watch",
      phases: ALL,
      worker: `
        const fs = require("node:fs"), path = require("node:path");
        const dir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "wtf-"));
        fs.watch(dir, () => hit());
        parentPort.postMessage({ dir });
        armed();
      `,
      host: phase => {
        let dir = "";
        let n = 0;
        let pump: ReturnType<typeof setInterval> | undefined;
        const touch = () => require("node:fs").writeFileSync(require("node:path").join(dir, "f" + n++), "x");
        return {
          // A platform watcher may coalesce or drop the event for a file created
          // right after it was armed; keep producing changes until the callback ran.
          onDir: (d: string) => {
            dir = d;
            if (phase !== "armed") {
              touch();
              pump = setInterval(touch, 5);
            }
          },
          onSignal: () => {
            clearInterval(pump);
            if (phase === "after") touch();
          },
          close: () => {
            clearInterval(pump);
            try {
              require("node:fs").rmSync(dir, { recursive: true, force: true });
            } catch {}
          },
        } as any;
      },
    },
    {
      name: "Bun.file().text()",
      phases: ["inside", "after"],
      worker: `Bun.file(process.execPath).slice(0, 1 << 20).text().then(() => hit(() => Bun.file(process.execPath).slice(0, 4096).text()));`,
    },
    {
      name: "Bun.file().stream() pull",
      phases: ["inside", "after"],
      worker: `(async () => { const r = Bun.file(process.execPath).stream().getReader(); await r.read(); hit(() => r.read().catch(() => {})); await r.read().catch(() => {}); })();`,
    },
    {
      name: "Bun.write",
      phases: ["inside", "after"],
      worker: `
        const p = require("node:path").join(require("node:os").tmpdir(), "wtf-" + Math.random().toString(36).slice(2));
        Bun.write(p, Buffer.alloc(1 << 20)).then(() => hit(() => Bun.write(p, "y"))).finally(() => require("node:fs").rm(p, () => {}));
      `,
    },
  ],

  pool: [
    {
      name: "crypto.pbkdf2",
      phases: ["inside", "after"],
      worker: `const c = require("node:crypto"); c.pbkdf2("p", "s", 1000, 32, "sha256", () => hit(() => c.pbkdf2("p", "s", 5000, 32, "sha256", () => {})));`,
    },
    {
      name: "crypto.scrypt",
      phases: ["inside", "after"],
      worker: `const c = require("node:crypto"); c.scrypt("p", "s", 32, () => hit(() => c.scrypt("p", "s", 32, () => {})));`,
    },
    {
      name: "crypto.randomFill",
      phases: ["inside", "after"],
      worker: `const c = require("node:crypto"); c.randomFill(Buffer.alloc(1 << 16), () => hit(() => c.randomFill(Buffer.alloc(1 << 16), () => {})));`,
    },
    {
      name: "crypto.generateKeyPair",
      phases: ["inside", "after"],
      worker: `const c = require("node:crypto"); c.generateKeyPair("ec", { namedCurve: "P-256" }, () => hit(() => c.generateKeyPair("ec", { namedCurve: "P-256" }, () => {})));`,
    },
    {
      name: "crypto.subtle.digest",
      phases: ["inside", "after"],
      worker: `crypto.subtle.digest("SHA-256", Buffer.alloc(1 << 16)).then(() => hit(() => crypto.subtle.digest("SHA-256", Buffer.alloc(1 << 20))));`,
    },
    {
      name: "zlib.gzip callback",
      phases: ["inside", "after"],
      worker: `const z = require("node:zlib"); z.gzip(Buffer.alloc(1 << 16), () => hit(() => z.gzip(Buffer.alloc(1 << 20), () => {})));`,
    },
    {
      name: "zlib stream data",
      phases: ["inside", "after"],
      worker: `const z = require("node:zlib"); const g = z.createGzip(); g.on("data", () => hit(() => g.write(Buffer.alloc(1 << 16)))); g.write(Buffer.alloc(1 << 16)); g.flush();`,
    },
    {
      name: "CompressionStream",
      phases: ["inside", "after"],
      worker: `
        (async () => { const cs = new CompressionStream("gzip"); const w = cs.writable.getWriter(); const r = cs.readable.getReader();
          w.write(new Uint8Array(1 << 17)); await r.read(); hit(() => { w.write(new Uint8Array(1 << 17)); r.read().catch(() => {}); }); })();
      `,
    },
    {
      name: "Bun.password.hash",
      phases: ["inside", "after"],
      worker: `Bun.password.hash("x", { algorithm: "bcrypt", cost: 4 }).then(() => hit(() => Bun.password.hash("y", { algorithm: "bcrypt", cost: 4 })));`,
    },
    {
      name: "Bun.Glob scan",
      phases: ["inside", "after"],
      worker: `(async () => { const it = new Bun.Glob("*").scan({ cwd: require("node:os").tmpdir() })[Symbol.asyncIterator](); await it.next(); hit(() => it.next().catch(() => {})); })();`,
    },
  ],

  subprocess: [
    {
      name: "child_process exit",
      phases: ["inside", "after"],
      worker: `const cp = require("node:child_process"); cp.execFile(process.execPath, ["-e", "0"], () => hit(() => cp.execFile(process.execPath, ["-e", "0"], () => {})));`,
    },
    {
      name: "child stdout data",
      phases: ["inside", "after"],
      worker: `const cp = require("node:child_process"); const c = cp.spawn(process.execPath, ["-e", "process.stdout.write('x'.repeat(1<<16))"]); c.stdout.on("data", () => hit()); c.on("error", () => {});`,
    },
    {
      name: "Bun.spawn exited + stdout",
      phases: ["inside", "after"],
      worker: `(async () => { const p = Bun.spawn([process.execPath, "-e", "console.log('x')"], { stdout: "pipe" }); await p.exited; hit(() => Bun.spawn([process.execPath, "-e", "0"])); await p.stdout.text(); })();`,
    },
    {
      name: "Bun.$",
      phases: ["inside", "after"],
      worker:
        "(async () => { await Bun.$`echo hi`.quiet(); hit(() => Bun.$`echo again`.quiet().catch(() => {})); })();",
    },
    {
      name: "child running at stop",
      phases: ["armed"],
      worker: `const c = require("node:child_process").spawn(process.execPath, ["-e", "setTimeout(()=>{}, 30000)"]); c.on("spawn", () => armed()); c.on("error", () => {});`,
    },
  ],

  dns: [
    {
      name: "dns.lookup",
      phases: ["inside", "after"],
      worker: `const dns = require("node:dns"); dns.lookup("localhost", () => hit(() => dns.lookup("localhost", { all: true }, () => {})));`,
    },
    {
      name: "dns.promises.lookup",
      phases: ["inside", "after"],
      worker: `const dns = require("node:dns"); dns.promises.lookup("localhost").then(() => hit(() => dns.promises.lookup("localhost", { family: 6 }).catch(() => {})));`,
    },
    {
      name: "Bun.dns.lookup",
      phases: ["inside", "after"],
      worker: `Bun.dns.lookup("localhost").then(() => hit(() => Bun.dns.lookup("localhost", { family: 4 })));`,
    },
    {
      name: "lookup in flight at stop",
      phases: ["armed"],
      worker: `parentPort.on("message", () => {}); require("node:dns").lookup("localhost", () => {}); armed();`,
    },
  ],

  loader: [
    {
      name: "dynamic import settle",
      phases: ["inside", "after"],
      worker: `import("node:zlib").then(() => hit(() => import("node:tls")));`,
    },
    {
      name: "require inside a callback",
      phases: ["inside", "after"],
      worker: `setImmediate(() => { hit(); require("node:https"); require("node:vm"); });`,
    },
    {
      name: "vm.runInContext with timeout",
      phases: ["inside", "after"],
      worker: `const vm = require("node:vm"); setImmediate(() => { hit(() => vm.runInNewContext("1", {}, { timeout: 1000 })); vm.runInNewContext("for (let i=0;i<1e5;i++);", {}, { timeout: 1000 }); });`,
    },
    {
      name: "FinalizationRegistry callback",
      phases: ["inside", "after"],
      worker: `
        parentPort.on("message", () => {});
        const fr = new FinalizationRegistry(() => hit(() => { fr.register({}, 2); Bun.gc(true); }));
        (() => { fr.register({}, 1); })();
        Bun.gc(true); setImmediate(() => Bun.gc(true));
      `,
    },
    {
      name: "Atomics.waitAsync settle",
      phases: ["inside", "after"],
      worker: `
        const ia = new Int32Array(new SharedArrayBuffer(4));
        Atomics.waitAsync(ia, 0, 0, 10).value.then(() => hit(() => Atomics.waitAsync(ia, 0, 0, 10)));
        parentPort.on("message", () => {});
      `,
    },
    {
      name: "WebAssembly.instantiate settle",
      phases: ["inside", "after"],
      worker: `const bytes = new Uint8Array([0,97,115,109,1,0,0,0]); WebAssembly.instantiate(bytes).then(() => hit(() => WebAssembly.instantiate(bytes)));`,
    },
    {
      name: "EventTarget dispatch",
      phases: ["inside", "after"],
      // The re-arm is a later dispatch, like the other entries' follow-on completions. A synchronous
      // re-dispatch from inside the listener recursed until the stack overflowed; that uncaught
      // RangeError stops the worker, so it never reached the "after" point.
      worker: `const et = new EventTarget(); et.addEventListener("x", () => hit(() => setImmediate(() => et.dispatchEvent(new Event("x"))))); setImmediate(() => et.dispatchEvent(new Event("x")));`,
    },
    {
      name: "process.on('exit') handlers",
      phases: ["armed"],
      worker: `parentPort.on("message", () => {}); process.on("exit", () => {}); armed();`,
    },
  ],

  counted: [
    {
      name: "Bun.build plugin onLoad pending",
      phases: ["armed"],
      worker: `
        parentPort.on("message", () => {});
        Bun.build({ entrypoints: ["virtual:entry"], plugins: [{ name: "p", setup(b) {
          b.onResolve({ filter: /^virtual:/ }, a => ({ path: a.path, namespace: "v" }));
          b.onLoad({ filter: /.*/, namespace: "v" }, () => new Promise(() => { armed(); }));
        } }] }).catch(() => {});
      `,
    },
    {
      name: "zlib stream write in flight",
      phases: ["armed"],
      worker: `parentPort.on("message", () => {}); const g = require("node:zlib").createGzip(); g.on("data", () => {}); g.write(Buffer.alloc(1 << 22)); armed();`,
    },
    {
      name: "fetch body streaming at stop",
      phases: ["armed"],
      worker: `
        parentPort.on("message", () => {});
        fetch("http://127.0.0.1:" + params.port + "/stream").then(r => r.body.getReader().read()).then(() => armed()).catch(() => {});
      `,
      host: phase => httpPeer(phase),
    },
    {
      name: "resources open at stop",
      phases: ["armed"],
      worker: `
        const { Database } = require("bun:sqlite"); const db = new Database(":memory:"); db.run("create table t(a)");
        Bun.serve({ port: 0, development: false, fetch: () => new Response("x") });
        require("node:dgram").createSocket("udp4").bind(0);
        require("node:fs").watch(require("node:os").tmpdir(), () => {});
        Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
        setInterval(() => {}, 1000);
        armed();
      `,
    },
  ],
};

// An HTTP peer in the parent: "/armed" never answers; anything else streams a
// chunk immediately and another on signal; nothing ever completes the body.
async function httpPeer(phase: Phase): Promise<Handle> {
  const pending = new Set<ReadableStreamDefaultController>();
  const enc = new TextEncoder();
  const srv = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    idleTimeout: 0,
    development: false,
    fetch(req) {
      if (new URL(req.url).pathname === "/armed") return new Promise<Response>(() => {});
      return new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(enc.encode("x".repeat(1024)));
            pending.add(c);
          },
          cancel() {},
        }),
      );
    },
  });
  return {
    params: { port: srv.port },
    onSignal: () => {
      if (phase === "after")
        for (const c of pending) {
          try {
            c.enqueue(enc.encode("y"));
          } catch {}
        }
    },
    close: () => {
      for (const c of pending) {
        try {
          c.close();
        } catch {}
      }
      srv.stop(true);
    },
  };
}

// A one-connection TCP peer in the parent.
async function tcpPeer(
  phase: Phase,
  o: { writeOnOpen?: boolean; endOnOpen?: boolean; writeOnSignal?: boolean },
): Promise<Handle> {
  let sock: net.Socket | undefined;
  const server = net.createServer(c => {
    sock = c;
    c.on("error", () => {});
    if (o.writeOnOpen) c.write("x");
    if (o.endOnOpen) c.end("x");
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", () => r()));
  return {
    params: { port: (server.address() as net.AddressInfo).port },
    onSignal: () => {
      if (o.writeOnSignal) sock?.write("y");
    },
    close: () => {
      sock?.destroy();
      server.close();
    },
  };
}

const DEADLINE_MS = 20_000;

async function runCase(entry: Entry, phase: Phase): Promise<string | null> {
  const ctl = new Int32Array(new SharedArrayBuffer(16));
  let w!: Worker;
  const h: any = (await entry.host?.(phase, () => w)) ?? {};
  const src = PRELUDE + entry.worker;
  w = new Worker(src, { eval: true, workerData: { ctl, phase, params: h.params }, transferList: h.transfer ?? [] });
  const exited = new Promise<number>(res => w.once("exit", res));
  let error: unknown = null;
  w.on("error", e => (error = e));
  let received = 0;
  w.on("message", m => {
    received++;
    if (typeof m === "number" && received === 1) h.onPort?.(m);
    else if (m && typeof m === "object" && "dir" in m) h.onDir?.(m.dir);
    else if (m === "ready") w.postMessage(1);
  });

  const deadline = new Promise<"deadline">(res => setTimeout(() => res("deadline"), DEADLINE_MS).unref());
  if (h.natural) {
    const code = await Promise.race([exited, deadline]);
    h.close?.();
    if (code === "deadline") {
      void w.terminate();
      return "no exit";
    }
    if (received !== h.natural) return `got ${received}/${h.natural} messages before exit`;
    return null;
  }
  // Wait for the worker to reach the point.
  const { async, value } = Atomics.waitAsync(ctl, 0, 0, DEADLINE_MS);
  const reached = async ? await Promise.race([value, exited.then(() => "exited-early")]) : value;
  if (reached !== "ok" && reached !== "not-equal") {
    h.close?.();
    void w.terminate();
    return `never reached the ${phase} point (${reached}${error ? "; " + (error as Error).message : ""})`;
  }
  await h.onSignal?.();
  const t = w.terminate();
  Atomics.store(ctl, 1, 1);
  Atomics.notify(ctl, 1); // release an "inside" callback
  const code = await Promise.race([exited, deadline]);
  h.close?.();
  if (code === "deadline") return "no exit after terminate()";
  await t;
  return null;
}

const family = process.argv[2];
const entries = FAMILIES[family];
if (!entries) {
  console.error("unknown family " + family + "; have " + Object.keys(FAMILIES).join(","));
  process.exit(2);
}
if (process.argv[3] === "--list") {
  console.log(Object.keys(FAMILIES).join("\n"));
  process.exit(0);
}

const cases = entries.flatMap(e => e.phases.map(p => [e, p] as const));
const failures: string[] = [];
// Bounded concurrency keeps wall time low without piling up live VMs.
const K = 6;
let next = 0;
await Promise.all(
  Array.from({ length: K }, async () => {
    while (next < cases.length) {
      const [e, p] = cases[next++];
      const why = await runCase(e, p).catch(err => "host error: " + (err?.stack ?? err));
      if (why) failures.push(`${e.name} [${p}]: ${why}`);
    }
  }),
);
if (failures.length) {
  console.log("FAIL\n" + failures.join("\n"));
  process.exit(1);
}
console.log("ok " + cases.length);
process.exit(0);
