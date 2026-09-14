// Bun.ModuleGraph({ isolateIO: true }): every way the runtime calls back into a graph's script
// finds that graph's context current — also while other graphs and the host are doing the same
// things at the same time. One entry per kind of callback; add one when adding an API that calls back.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { rmSync } from "fs";
import { bunExe, tempDir } from "harness";
import { AsyncLocalStorage } from "node:async_hooks";
import { join } from "path";

const ModuleGraph = Bun.ModuleGraph;

const dir = String(
  tempDir("module-graph-callbacks-", {
    "data.txt": "0123456789".repeat(1000),
    // A 1x1 PNG.
    "pixel.png": Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
      "base64",
    ),
    // Each entry resolves once all of its callbacks have run. `seen(label)` is the host's: it records
    // which graph's context the callback found.
    "callbacks.mjs": `
      import fs from "node:fs";
      import net from "node:net";
      import http from "node:http";
      import zlib from "node:zlib";
      import crypto from "node:crypto";
      import dns from "node:dns";
      import childProcess from "node:child_process";
      import { EventEmitter, once } from "node:events";
      import { pipeline } from "node:stream/promises";
      import timersPromises from "node:timers/promises";

      const data = import.meta.dir + "/data.txt";
      const defer = () => Promise.withResolvers();

      export const callbacks = {
        setTimeout: seen => new Promise(resolve => setTimeout(() => { seen("fired"); resolve(); }, 1)),
        setInterval: seen => new Promise(resolve => { let n = 0; const interval = setInterval(() => { seen("tick " + ++n); if (n === 2) { clearInterval(interval); resolve(); } }, 1); }),
        setImmediate: seen => new Promise(resolve => setImmediate(() => { seen("fired"); resolve(); })),
        nextTick: seen => new Promise(resolve => process.nextTick(() => { seen("fired"); resolve(); })),
        queueMicrotask: seen => new Promise(resolve => queueMicrotask(() => { seen("fired"); resolve(); })),
        promiseThen: seen => Promise.resolve().then(() => seen("then")),
        awaitTimer: async seen => { await new Promise(resolve => setTimeout(resolve, 1)); seen("after await"); },
        timersPromises: async seen => { await timersPromises.setTimeout(1); seen("after await"); for await (const _ of timersPromises.setInterval(1)) { seen("interval iteration"); break; } },
        bunSleep: async seen => { await Bun.sleep(1); seen("after await"); },

        eventTarget: seen => { const target = new EventTarget(); target.addEventListener("go", () => seen("listener")); target.dispatchEvent(new Event("go")); },
        eventEmitter: async seen => { const emitter = new EventEmitter(); const heard = once(emitter, "go"); setTimeout(() => emitter.emit("go"), 1); await heard; seen("once"); },
        abortSignalTimeout: seen => new Promise(resolve => AbortSignal.timeout(1).addEventListener("abort", () => { seen("abort"); resolve(); })),
        abortController: seen => new Promise(resolve => { const controller = new AbortController(); controller.signal.addEventListener("abort", () => { seen("abort"); resolve(); }); setTimeout(() => controller.abort(), 1); }),
        abortSignalAny: seen =>
          new Promise(resolve => {
            const controller = new AbortController();
            AbortSignal.any([controller.signal, AbortSignal.timeout(60_000)]).addEventListener("abort", () => { seen("abort"); resolve(); });
            setTimeout(() => controller.abort(), 1);
          }),
        transferredPort: seen =>
          new Promise(resolve => {
            // A port that arrives in a message is the receiving script's.
            const outer = new MessageChannel(), inner = new MessageChannel();
            outer.port1.onmessage = event => {
              seen("outer message");
              const [port] = event.ports;
              port.onmessage = () => { seen("transferred port message"); port.close(); outer.port1.close(); resolve(); };
              inner.port2.postMessage(1);
            };
            outer.port2.postMessage(0, [inner.port1]);
          }),
        performanceObserver: seen =>
          new Promise(resolve => {
            const observer = new PerformanceObserver(() => { seen("entries"); observer.disconnect(); resolve(); });
            observer.observe({ entryTypes: ["mark"] });
            performance.mark("callbacks-test");
          }),
        messageChannel: seen => new Promise(resolve => { const { port1, port2 } = new MessageChannel(); port1.onmessage = () => { seen("message"); port1.close(); resolve(); }; port2.postMessage(1); }),
        broadcastChannel: (seen, env) => new Promise(resolve => { const a = new BroadcastChannel("callbacks-" + env.tag); const b = new BroadcastChannel("callbacks-" + env.tag); a.onmessage = () => { seen("message"); a.close(); b.close(); resolve(); }; b.postMessage(1); }),
        worker: seen => new Promise(resolve => { const worker = new Worker("data:text/javascript,postMessage(1)"); worker.onmessage = () => { seen("message"); }; worker.addEventListener("close", () => { seen("close"); resolve(); }); }),

        bunListenAndConnect: async seen => {
          const closed = defer(), serverClosed = defer();
          const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: {
            open(socket) { seen("server open"); },
            data(socket, chunk) { seen("server data"); socket.write(chunk); },
            close() { seen("server close"); serverClosed.resolve(); },
          } });
          await Bun.connect({ hostname: "127.0.0.1", port: server.port, socket: {
            open(socket) { seen("client open"); socket.write("ping"); },
            data(socket) { seen("client data"); socket.end(); },
            close() { seen("client close"); closed.resolve(); },
          } });
          await Promise.all([closed.promise, serverClosed.promise]);
          server.stop(true);
        },
        nodeNet: async seen => {
          const done = defer();
          const server = net.createServer(socket => { seen("server connection"); socket.on("data", chunk => { seen("server data"); socket.end(chunk); }); });
          await new Promise(resolve => server.listen(0, "127.0.0.1", () => { seen("listening"); resolve(); }));
          const client = net.connect(server.address().port, "127.0.0.1", () => { seen("client connect"); client.write("ping"); });
          client.on("data", () => seen("client data"));
          client.on("close", () => { seen("client close"); server.close(() => { seen("server close"); done.resolve(); }); });
          await done.promise;
        },
        udp: async seen => {
          const got = defer();
          const socket = await Bun.udpSocket({ hostname: "127.0.0.1", port: 0, socket: { data() { seen("data"); got.resolve(); } } });
          socket.send("x", socket.port, "127.0.0.1");
          await got.promise;
          socket.close();
        },
        webSocketClient: (seen, env) => new Promise(resolve => {
          const ws = new WebSocket("ws://127.0.0.1:" + env.httpPort + "/ws");
          ws.onopen = () => { seen("open"); ws.send("ping"); };
          ws.onmessage = () => { seen("message"); ws.close(); };
          ws.onclose = () => { seen("close"); resolve(); };
        }),
        webSocketClientWithOptions: (seen, env) =>
          new Promise(resolve => {
            const ws = new WebSocket("ws://127.0.0.1:" + env.httpPort + "/ws", { headers: { "x-test": "1" } });
            ws.addEventListener("open", () => { seen("open"); ws.send("ping"); });
            ws.addEventListener("message", () => { seen("message"); ws.close(); });
            ws.addEventListener("close", () => { seen("close"); resolve(); });
          }),
        bunServe: async seen => {
          const closed = defer();
          const server = Bun.serve({
            port: 0,
            async fetch(request, server) {
              seen("fetch handler");
              if (new URL(request.url).pathname === "/ws") return server.upgrade(request) ? undefined : new Response("no");
              await Bun.sleep(1);
              seen("fetch handler after await");
              return new Response("served");
            },
            websocket: {
              open(ws) { seen("ws open"); },
              message(ws, message) { seen("ws message"); ws.send(message); },
              close() { seen("ws close"); closed.resolve(); },
            },
          });
          // Requests from this same script: the handlers run for the server's graph either way.
          await (await fetch(server.url)).text();
          await new Promise(resolve => { const ws = new WebSocket("ws://127.0.0.1:" + server.port + "/ws"); ws.onopen = () => ws.send("x"); ws.onmessage = () => ws.close(); ws.onclose = resolve; });
          await closed.promise;
          server.stop(true);
        },
        nodeHttp: async seen => {
          const server = http.createServer((request, response) => { seen("server request"); request.on("end", () => { seen("server request end"); response.end("ok"); }).resume(); });
          await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
          await new Promise(resolve => {
            http.get({ host: "127.0.0.1", port: server.address().port }, response => {
              seen("client response");
              response.on("data", () => seen("client data"));
              response.on("end", () => { seen("client end"); resolve(); });
            });
          });
          await new Promise(resolve => server.close(resolve));
        },

        fetch: async (seen, env) => {
          const response = await fetch("http://127.0.0.1:" + env.httpPort + "/ok");
          seen("after fetch");
          await response.text();
          seen("after text()");
          const streamed = await fetch("http://127.0.0.1:" + env.httpPort + "/stream");
          for await (const chunk of streamed.body) seen("body chunk");
          await fetch("http://127.0.0.1:" + env.httpPort + "/ok").then(r => { seen("then"); return r.arrayBuffer(); }).then(() => seen("second then"));
        },

        fsCallback: seen => new Promise(resolve => fs.readFile(data, () => { seen("readFile callback"); fs.stat(data, () => { seen("stat callback"); resolve(); }); })),
        fsPromises: async seen => { await fs.promises.readFile(data); seen("after readFile"); await fs.promises.stat(data); seen("after stat"); const handle = await fs.promises.open(data); await handle.read(Buffer.alloc(10)); seen("after handle.read"); await handle.close(); },
        fsStreams: async (seen, env) => {
          await new Promise(resolve => fs.createReadStream(data).on("data", () => seen("read data")).on("close", () => { seen("read close"); resolve(); }));
          await pipeline(fs.createReadStream(data), fs.createWriteStream(data + "." + env.tag + ".copy"));
          seen("after pipeline");
        },
        fsWatch: (seen, env) => new Promise(resolve => {
          const watched = data + "." + env.tag + ".watched";
          fs.writeFileSync(watched, "0");
          const watcher = fs.watch(watched, () => { seen("change"); watcher.close(); resolve(); });
          const poke = setInterval(() => fs.writeFileSync(watched, String(Math.random())), 5);
          watcher.on("close", () => clearInterval(poke));
        }),
        bunFile: async (seen, env) => {
          await Bun.file(data).text(); seen("after text()");
          await Bun.file(data).arrayBuffer(); seen("after arrayBuffer()");
          for await (const chunk of Bun.file(data).stream()) seen("stream chunk");
          await Bun.write(data + "." + env.tag + ".out", "x".repeat(1 << 20)); seen("after write");
          await Bun.write(data + "." + env.tag + ".copied", Bun.file(data)); seen("after copy");
        },
        bunImage: async (seen, env) => {
          const png = import.meta.dir + "/pixel.png";
          await Bun.file(png).image().resize(64, 64).png().bytes(); seen("after bytes()");
          await Bun.file(png).image().resize(64, 64).png().write(Bun.file(png + "." + env.tag + ".out.png")); seen("after write()");
          await new Bun.Image(png).metadata(); seen("after metadata()");
        },

        bunSpawn: async (seen, env) => {
          const exited = defer();
          const proc = Bun.spawn({ cmd: [env.bun, "-e", "console.log('hi')"], stdout: "pipe", stderr: "ignore", onExit() { seen("onExit"); exited.resolve(); } });
          for await (const chunk of proc.stdout) seen("stdout chunk");
          await proc.exited; seen("after exited");
          await exited.promise;
        },
        childProcess: async (seen, env) => {
          await new Promise(resolve => childProcess.execFile(env.bun, ["-e", "console.log('hi')"], () => { seen("execFile callback"); resolve(); }));
          await new Promise(resolve => { const child = childProcess.spawn(env.bun, ["-e", "console.log('hi')"]); child.stdout.on("data", () => seen("stdout data")); child.on("exit", () => seen("exit")); child.on("close", () => { seen("close"); resolve(); }); });
        },
        shell: async seen => { await Bun.$\`echo hi\`.quiet(); seen("after builtin"); await Bun.$\`\${process.execPath} -e "1"\`.quiet(); seen("after command"); },

        zlib: async seen => {
          await new Promise(resolve => zlib.gzip("hello", () => { seen("gzip callback"); resolve(); }));
          await new Promise(resolve => zlib.brotliCompress("hello", () => { seen("brotli callback"); resolve(); }));
          await new Promise(resolve => { const gzip = zlib.createGzip(); gzip.on("data", () => seen("stream data")); gzip.on("end", () => { seen("stream end"); resolve(); }); gzip.end("x".repeat(100000)); });
        },
        crypto: async seen => {
          await new Promise(resolve => crypto.pbkdf2("pw", "salt", 1000, 32, "sha256", () => { seen("pbkdf2 callback"); resolve(); }));
          await new Promise(resolve => crypto.randomBytes(16, () => { seen("randomBytes callback"); resolve(); }));
          await new Promise(resolve => crypto.scrypt("pw", "salt", 32, { N: 1024 }, () => { seen("scrypt callback"); resolve(); }));
          await crypto.subtle.digest("SHA-256", new Uint8Array(1024)); seen("after subtle.digest");
          await Bun.password.hash("pw", { algorithm: "bcrypt", cost: 4 }); seen("after password.hash");
        },
        dns: async seen => {
          await new Promise(resolve => dns.lookup("localhost", () => { seen("lookup callback"); resolve(); }));
          await Bun.dns.lookup("localhost"); seen("after Bun.dns.lookup");
        },

        webStreams: async seen => {
          let pulled = 0;
          const readable = new ReadableStream({ pull(controller) { seen("pull"); if (++pulled === 2) controller.close(); else controller.enqueue(new Uint8Array(200000)); } });
          const transformed = readable.pipeThrough(new TransformStream({ transform(chunk, controller) { seen("transform"); controller.enqueue(chunk); }, flush() { seen("flush"); } })).pipeThrough(new CompressionStream("gzip"));
          await new Response(transformed).arrayBuffer(); seen("after arrayBuffer()");
          await new Promise(resolve => new ReadableStream({ start(controller) { controller.enqueue("x"); controller.close(); } }).pipeTo(new WritableStream({ write() { seen("sink write"); }, close() { seen("sink close"); resolve(); } })));
        },
      };
    `,
  }),
);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

let hostHttp: Bun.Server;
beforeAll(() => {
  hostHttp = Bun.serve({
    port: 0,
    fetch(request, server) {
      const { pathname } = new URL(request.url);
      if (pathname === "/ws") return server.upgrade(request) ? undefined : new Response("no", { status: 400 });
      if (pathname === "/stream")
        return new Response(
          new ReadableStream({
            async start(controller) {
              for (let i = 0; i < 3; i++) {
                controller.enqueue(new Uint8Array(1000));
                await Bun.sleep(1);
              }
              controller.close();
            },
          }),
        );
      return new Response("ok");
    },
    websocket: { message: (ws, message) => void ws.send(message) },
  });
});
afterAll(() => hostHttp.stop(true));

test("every callback of several graphs and the host, all running at once, finds its own graph's context", async () => {
  const storage = new AsyncLocalStorage<string>();
  const hostApp = await import(join(dir, "callbacks.mjs"));
  const names = Object.keys(hostApp.callbacks);
  type Runner = { tag: string; graph: InstanceType<typeof ModuleGraph> | undefined; app: any };
  const runners: Runner[] = [{ tag: "host", graph: undefined, app: hostApp }];
  using stack = new DisposableStack();
  for (const tag of ["a", "b", "c"]) {
    const graph = stack.adopt(new ModuleGraph({ isolateIO: true }), graph => graph.dispose());
    runners.push({ tag, graph, app: await graph.import(join(dir, "callbacks.mjs")) });
  }

  // label -> what each runner's callback found.
  const found: Record<string, Record<string, { context: string; store: string | undefined }>> = {};
  const failures: string[] = [];
  const whose = (graph: unknown) =>
    graph ? (runners.find(runner => runner.graph === graph)?.tag ?? "an unknown graph") : "host";
  await Promise.all(
    runners.flatMap(({ tag, graph, app }) =>
      names.map(name => {
        const seen = (event: string) => {
          (found[name + ": " + event] ??= {})[tag] = { context: whose(ModuleGraph.current), store: storage.getStore() };
        };
        const env = { tag, httpPort: hostHttp.port, bun: bunExe() };
        const start = () => storage.run(tag, () => app.callbacks[name](seen, env));
        return Promise.resolve()
          .then(() => (graph ? graph.run(start) : start()))
          .catch(error => void failures.push(`${name} in ${tag}: ${error}`));
      }),
    ),
  );
  expect(failures).toEqual([]);

  // Every callback ran for every runner, in that runner's context.
  const wrongContext: string[] = [];
  const wrongStore: string[] = [];
  const missing: string[] = [];
  for (const [label, byRunner] of Object.entries(found)) {
    for (const { tag } of runners) {
      const record = byRunner[tag];
      if (!record) missing.push(`${label} in ${tag}`);
      else if (record.context !== tag) wrongContext.push(`${label} in ${tag} ran in ${record.context}`);
      // Where the host's own callback keeps its AsyncLocalStorage store, a graph's does too.
      else if (byRunner.host?.store === "host" && record.store !== tag)
        wrongStore.push(`${label} in ${tag} saw store ${record.store}`);
    }
  }
  expect({ wrongContext, wrongStore, missing }).toEqual({ wrongContext: [], wrongStore: [], missing: [] });
  expect(Object.keys(found).length).toBeGreaterThan(100);
}, 30_000);
