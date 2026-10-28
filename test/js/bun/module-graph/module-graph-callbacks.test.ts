// Bun.ModuleGraph: every way the runtime calls back into a graph's script
// finds that graph's context current — also while other graphs and the host are doing the same
// things at the same time. One entry per kind of callback; add one when adding an API that calls back.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { promises, readFile, rmSync } from "fs";
import { bunEnv, bunExe, tempDir, tls as tlsCerts } from "harness";
import { AsyncLocalStorage } from "node:async_hooks";
import { pbkdf2 } from "node:crypto";
import { once } from "node:events";
import http from "node:http";
import { promisify } from "node:util";
import { join } from "path";

const ModuleGraph = Bun.ModuleGraph;

const dir = String(
  tempDir("module-graph-callbacks-", {
    "data.txt": Buffer.alloc(10000, "0123456789").toString(),
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
      import { WebSocketServer } from "ws";

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
        writableStreamSignal: seen =>
          new Promise(resolve => {
            const stream = new WritableStream({ start(controller) { controller.signal.addEventListener("abort", () => { seen("controller signal abort"); resolve(); }); } });
            setTimeout(() => stream.abort(), 1);
          }),
        // What the host made stays the host's when a graph's script is what sets it off.
        hostTarget: (seen, env) => { env.hostTarget.dispatchEvent(new Event("go")); env.hostController.abort(); },
        messageChannel: seen => new Promise(resolve => { const { port1, port2 } = new MessageChannel(); port1.onmessage = () => { seen("message"); port1.close(); resolve(); }; port2.postMessage(1); }),
        broadcastChannel: (seen, env) => new Promise(resolve => { const a = new BroadcastChannel("callbacks-" + env.tag); const b = new BroadcastChannel("callbacks-" + env.tag); a.onmessage = () => { seen("message"); a.close(); b.close(); resolve(); }; b.postMessage(1); }),
        worker: seen => new Promise(resolve => { const worker = new Worker("data:text/javascript,postMessage(1)"); worker.onmessage = () => { seen("message"); }; worker.addEventListener("close", () => { seen("close"); resolve(); }); }),

        portFromWorker: seen =>
          new Promise(resolve => {
            const worker = new Worker("data:text/javascript,const { port1, port2 } = new MessageChannel(); postMessage({ port: port2 }, [port2]); port1.postMessage(1);");
            worker.onmessage = event => {
              seen("worker message");
              event.data.port.onmessage = () => { seen("port from worker message"); event.data.port.close(); worker.terminate(); resolve(); };
            };
          }),
        serveRequestSignal: async seen => {
          // The client goes away while the handler is waiting.
          const aborted = defer(), reached = defer();
          const server = Bun.serve({
            port: 0,
            async fetch(request) {
              request.signal.addEventListener("abort", () => { seen("request.signal abort"); aborted.resolve(); });
              seen("fetch handler");
              reached.resolve();
              await aborted.promise;
              return new Response("late");
            },
          });
          const controller = new AbortController();
          fetch(server.url, { signal: controller.signal }).catch(() => {});
          await reached.promise;
          controller.abort();
          await aborted.promise;
          server.stop(true);
        },
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
        webSocketCheckServerIdentity: (seen, env) =>
          new Promise(resolve => {
            const ws = new WebSocket("wss://localhost:" + env.httpsPort + "/ws", {
              tls: { ca: env.ca, checkServerIdentity() { seen("checkServerIdentity"); } },
            });
            ws.onopen = () => ws.close();
            ws.onclose = resolve;
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
        wsServer: async seen => {
          const server = http.createServer();
          const closed = defer();
          new WebSocketServer({ server }).on("connection", ws => {
            seen("connection");
            ws.on("message", message => { seen("message"); ws.send(String(message)); });
            ws.on("ping", () => seen("ping"));
            ws.on("close", () => { seen("close"); closed.resolve(); });
          });
          await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
          await new Promise(resolve => { const ws = new WebSocket("ws://127.0.0.1:" + server.address().port); ws.onopen = () => { ws.ping(); ws.send("x"); }; ws.onmessage = () => ws.close(); ws.onclose = resolve; });
          await closed.promise;
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
          await Bun.write(data + "." + env.tag + ".out", Buffer.alloc(1 << 20, "x")); seen("after write");
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
          await new Promise(resolve => { const gzip = zlib.createGzip(); gzip.on("data", () => seen("stream data")); gzip.on("end", () => { seen("stream end"); resolve(); }); gzip.end(Buffer.alloc(100000, "x")); });
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

let hostHttp: Bun.Server<undefined>;
let hostHttps: Bun.Server<undefined>;
beforeAll(() => {
  hostHttps = Bun.serve({
    port: 0,
    tls: tlsCerts,
    fetch: (request, server) => (server.upgrade(request) ? undefined : new Response("no", { status: 400 })),
    websocket: { message() {} },
  });
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
afterAll(() => {
  hostHttp.stop(true);
  hostHttps.stop(true);
});

test("every callback of several graphs and the host, all running at once, finds its own graph's context", async () => {
  const storage = new AsyncLocalStorage<string>();
  const hostApp = await import(join(dir, "callbacks.mjs"));
  const names = Object.keys(hostApp.callbacks);
  type Runner = { tag: string; graph: InstanceType<typeof ModuleGraph> | undefined; app: any };
  const runners: Runner[] = [{ tag: "host", graph: undefined, app: hostApp }];
  using stack = new DisposableStack();
  for (const tag of ["a", "b", "c"]) {
    const graph = stack.adopt(new ModuleGraph(), graph => graph.dispose());
    runners.push({ tag, graph, app: await graph.import(join(dir, "callbacks.mjs")) });
  }

  // label -> what each runner's callback found.
  // label -> runner -> what every call of that callback found.
  const found: Record<string, Record<string, { context: string; store: string | undefined }[]>> = {};
  const record = (label: string, tag: string) =>
    ((found[label] ??= {})[tag] ??= []).push({ context: whose(ModuleGraph.current), store: storage.getStore() });
  const failures: string[] = [];
  const whose = (graph: unknown) =>
    graph ? (runners.find(runner => runner.graph === graph)?.tag ?? "an unknown graph") : "host";
  // The host's own listeners, which each runner's script sets off: they run as the host's.
  const hostListenerLabels: string[] = [];
  await Promise.all(
    runners.flatMap(({ tag, graph, app }) =>
      names.map(name => {
        const seen = (event: string) => record(name + ": " + event, tag);
        const env: Record<string, unknown> = {
          tag,
          httpPort: hostHttp.port,
          httpsPort: hostHttps.port,
          ca: tlsCerts.cert,
          bun: bunExe(),
        };
        if (name === "hostTarget") {
          const labels = [`host listener (dispatched from ${tag})`, `host abort listener (aborted from ${tag})`];
          hostListenerLabels.push(...labels);
          const hostTarget = new EventTarget();
          hostTarget.addEventListener("go", () => storage.run("host", () => record(labels[0], "host")));
          const hostController = new AbortController();
          hostController.signal.addEventListener("abort", () => storage.run("host", () => record(labels[1], "host")));
          Object.assign(env, { hostTarget, hostController });
        }
        const start = () => storage.run(tag, () => app.callbacks[name](seen, env));
        return Promise.resolve()
          .then(() => (graph ? graph.run(start) : start()))
          .catch(error => void failures.push(`${name} in ${tag}: ${error}`));
      }),
    ),
  );
  expect(failures).toEqual([]);

  const wrongContext: string[] = [];
  const wrongStore: string[] = [];
  const missing: string[] = [];
  for (const label of hostListenerLabels) {
    const calls = found[label]?.host ?? [];
    if (!calls.length) missing.push(label);
    for (const call of calls) if (call.context !== "host") wrongContext.push(`${label} ran in ${call.context}`);
    delete found[label];
  }
  // Every callback ran for every runner, every time in that runner's context.
  for (const [label, byRunner] of Object.entries(found)) {
    // Where the host's own callback has no AsyncLocalStorage store (a MessagePort's, say), nobody's has.
    const hostKeepsStore = (byRunner.host ?? []).every(call => call.store === "host");
    for (const { tag } of runners) {
      const calls = byRunner[tag] ?? [];
      if (!calls.length) missing.push(`${label} in ${tag}`);
      for (const call of calls) {
        if (call.context !== tag) wrongContext.push(`${label} in ${tag} ran in ${call.context}`);
        else if (call.store !== (hostKeepsStore ? tag : undefined))
          wrongStore.push(`${label} in ${tag} saw store ${call.store}`);
      }
    }
  }
  expect({ wrongContext, wrongStore, missing }).toEqual({ wrongContext: [], wrongStore: [], missing: [] });
  // Every entry reported at least one callback.
  expect(
    names.filter(name => name !== "hostTarget" && !Object.keys(found).some(label => label.startsWith(name + ": "))),
  ).toEqual([]);
  // (One test on purpose, and slow on a debug build: it is everything running at once.)
}, 30_000);

// What script has a host function call back is called in whatever turn that script runs. The event
// loop delivers a graph's callback inside the graph's context and runs the microtask checkpoint that
// follows there too, so whoever awaited the graph's work continues in that turn. A dispose() made
// then costs nobody those calls: the host's script, another graph's and the disposed graph's own
// leftover script are all script that is running. What the event loop would still deliver to the
// disposed graph stays undelivered.
describe("dispose() in the turn that delivered a graph's callback", () => {
  let counted: Bun.Server<undefined>;
  let handled = 0;
  beforeAll(() => {
    counted = Bun.serve({ port: 0, fetch: () => (handled++, new Response("handled")) });
  });
  afterAll(() => counted.stop(true));

  /** What script gets from host functions that call it back before they return. */
  const calledBack = () => {
    const before = handled;
    Promise.resolve(counted.fetch(new Request("http://host/"))).catch(() => {});
    return {
      rewritten: new HTMLRewriter()
        .on("a", { element: element => void element.setAttribute("seen", "yes") })
        .transform("<a></a>"),
      rendered: Bun.markdown.render("# hi", { heading: children => `<h1 class="mine">${children}</h1>` }),
      handled: handled - before,
    };
  };
  const called = {
    rewritten: '<a seen="yes"></a>',
    rendered: '<h1 class="mine">hi</h1>',
    handled: 1,
  };

  const file = join(dir, "data.txt");
  const turn = () => new Promise<void>(resolve => setImmediate(resolve));
  /** A listener of the host's that greets whoever connects. `gone` settles when it has seen that connection go. */
  const greeter = () => {
    const gone = Promise.withResolvers<void>();
    const listener = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: { open: socket => void socket.write("hello"), data() {}, close: () => gone.resolve() },
    });
    return { port: listener.port, gone: gone.promise, [Symbol.dispose]: () => void listener.stop(true) };
  };

  /** Work whose result the event loop delivers inside the context it was started in, by what delivers it. */
  const deliveries: Record<string, () => Promise<unknown>> = {
    "fs.promises.readFile": () => promises.readFile(file),
    "fs.readFile callback": () => new Promise(resolve => readFile(file, resolve)),
    "Bun.file().text()": () => Bun.file(file).text(),
    "Bun.password.hash": () => Bun.password.hash("pw", { algorithm: "bcrypt", cost: 4 }),
    "crypto.pbkdf2": () => promisify(pbkdf2)("pw", "salt", 1000, 32, "sha256"),
    "Bun.spawn().exited": () =>
      Bun.spawn({ cmd: [bunExe(), "-e", "1"], env: bunEnv, stdio: ["ignore", "ignore", "ignore"] }).exited,
    "fetch()": () => fetch(counted.url).then(response => response.text()),
    "a Bun.connect data handler": async () => {
      const received = Promise.withResolvers<void>();
      const listener = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        socket: { open: socket => void socket.write("hello"), data() {} },
      });
      await Bun.connect({
        hostname: "127.0.0.1",
        port: listener.port,
        socket: { data: () => received.resolve() },
      });
      return received.promise;
    },
    "a Bun.udpSocket data handler": async () => {
      const received = Promise.withResolvers<void>();
      const receiver = await Bun.udpSocket({ hostname: "127.0.0.1", socket: { data: () => received.resolve() } });
      const sender = await Bun.udpSocket({ hostname: "127.0.0.1" });
      sender.send("hello", receiver.port, "127.0.0.1");
      return received.promise;
    },
    "a Bun.serve fetch handler": () => {
      const requested = Promise.withResolvers<void>();
      const server = Bun.serve({ port: 0, fetch: () => (requested.resolve(), new Response()) });
      fetch(server.url).catch(() => {});
      return requested.promise;
    },
  };

  for (const [what, work] of Object.entries(deliveries)) {
    test.concurrent(`the host, continuing after ${what}`, async () => {
      using graph = new ModuleGraph();
      await graph.run(work);
      graph.dispose();
      expect(calledBack()).toEqual(called);
    });
  }

  test.concurrent("the host, some microtasks further into that turn", async () => {
    using graph = new ModuleGraph();
    await graph.run(deliveries["fs.promises.readFile"]);
    graph.dispose();
    for (let i = 0; i < 3; i++) await null;
    expect(calledBack()).toEqual(called);
  });

  test.concurrent("the host, answering a node:http request: the response arrives whole", async () => {
    const server = http.createServer(async (_, response) => {
      using graph = new ModuleGraph();
      await graph.run(deliveries["fs.promises.readFile"]);
      graph.dispose();
      response.write("from ");
      response.end("the host");
    });
    await once(server.listen(0, "127.0.0.1"), "listening");
    try {
      const response = await fetch(`http://127.0.0.1:${(server.address() as { port: number }).port}/`);
      expect(await response.text()).toBe("from the host");
    } finally {
      server.close();
    }
  });

  test.concurrent("another graph, continuing in that turn", async () => {
    using disposed = new ModuleGraph();
    using other = new ModuleGraph();
    const work = disposed.run(deliveries["fs.promises.readFile"]);
    const got = await other.run(async () => {
      await work;
      disposed.dispose();
      return { current: ModuleGraph.current === other, ...calledBack() };
    });
    expect(got).toEqual({ current: true, ...called });
  });

  test.concurrent("a listener of the host's that the graph's callback dispatches to", async () => {
    using graph = new ModuleGraph();
    const target = new EventTarget();
    const got = Promise.withResolvers<unknown>();
    target.addEventListener("done", () => {
      graph.dispose();
      got.resolve({ current: ModuleGraph.current, ...calledBack() });
    });
    graph.run(() => readFile(file, () => void target.dispatchEvent(new Event("done"))));
    expect(await got.promise).toEqual({ current: undefined, ...called });
  });

  // The graph's own script carries on after it disposed its graph: what it calls through a host
  // function is called, wherever that script was started from (a timer is not delivered inside a
  // context). What it starts settles nothing, and what it had open hears nothing.
  const startedFrom: Record<string, (script: () => void) => unknown> = {
    "a reaction to its work": script => deliveries["fs.promises.readFile"]().then(script),
    "a callback of its work": script => readFile(file, script),
    "a timer": script => setTimeout(script, 1),
  };
  for (const [where, start] of Object.entries(startedFrom)) {
    test.concurrent(`the graph's own script, disposing its graph from ${where}`, async () => {
      using host = greeter();
      using graph = new ModuleGraph();
      const heard: string[] = [];
      await graph.run(() =>
        Bun.connect({
          hostname: "127.0.0.1",
          port: host.port,
          socket: { data() {}, close: () => void heard.push("close") },
        }),
      );
      const got = Promise.withResolvers<ReturnType<typeof calledBack> & { started: Promise<unknown> }>();
      graph.run(() =>
        start(() => {
          graph.dispose();
          got.resolve({ ...calledBack(), started: deliveries["Bun.file().text()"]() });
        }),
      );
      const { started, ...calls } = await got.promise;
      await host.gone;
      expect({ ...calls, started: Bun.peek.status(started), heard }).toEqual({
        ...called,
        started: "pending",
        heard: [],
      });
    });
  }

  test.concurrent(
    "a socket handler that disposes its graph: its script carries on, and the socket's other handlers hear nothing",
    async () => {
      using host = greeter();
      using graph = new ModuleGraph();
      const heard: string[] = [];
      const got = Promise.withResolvers<unknown>();
      graph.run(() =>
        Bun.connect({
          hostname: "127.0.0.1",
          port: host.port,
          socket: {
            data() {
              heard.push("data");
              graph.dispose();
              got.resolve(calledBack());
            },
            end: () => void heard.push("end"),
            close: () => void heard.push("close"),
            error: () => void heard.push("error"),
          },
        }),
      );
      expect(await got.promise).toEqual(called);
      await host.gone;
      expect(heard).toEqual(["data"]);
    },
  );

  test.concurrent("onExit is not called once whoever awaited `exited` has disposed the graph", async () => {
    using graph = new ModuleGraph();
    const heard: string[] = [];
    const child: Bun.Subprocess = graph.run(() =>
      Bun.spawn({
        cmd: [bunExe(), "-e", "1"],
        env: bunEnv,
        stdio: ["ignore", "ignore", "ignore"],
        onExit: () => void heard.push("onExit"),
      }),
    );
    await child.exited;
    graph.dispose();
    const calls = calledBack();
    await turn();
    expect({ ...calls, heard }).toEqual({ ...called, heard: [] });
  });

  test.concurrent(
    "the onError of a graph whose maker was disposed: it runs as the maker, and is script like any other",
    async () => {
      using maker = new ModuleGraph();
      const reported = Promise.withResolvers<unknown>();
      const made = maker.run(
        () => new ModuleGraph({ onError: error => reported.resolve([(error as Error).message, calledBack()]) }),
      );
      made.run(() =>
        queueMicrotask(() => {
          throw new Error("late");
        }),
      );
      maker.dispose();
      expect(await reported.promise).toEqual(["late", called]);
    },
  );

  test("the host, continuing after every kind of callback above", async () => {
    const { callbacks } = await import(join(dir, "callbacks.mjs"));
    const names = Object.keys(callbacks);
    const got: Record<string, unknown> = {};
    await Promise.all(
      names.map(async name => {
        using graph = new ModuleGraph();
        const env = {
          tag: "disposed-after-" + name,
          httpPort: hostHttp.port,
          httpsPort: hostHttps.port,
          ca: tlsCerts.cert,
          bun: bunExe(),
          hostTarget: new EventTarget(),
          hostController: new AbortController(),
        };
        await graph.run(() => callbacks[name](() => {}, env));
        graph.dispose();
        got[name] = calledBack();
      }),
    );
    expect(got).toEqual(Object.fromEntries(names.map(name => [name, called])));
    // (One test, as above: it is everything running at once.)
  }, 30_000);
});
