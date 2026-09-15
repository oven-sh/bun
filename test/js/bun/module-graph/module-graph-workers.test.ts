// Bun.ModuleGraph crossed with worker threads: every state a graph and a worker can be in when
// graph.dispose(), worker.terminate(), process.exit(), an uncaught error or a collection lands, in
// either order and from either side. The cells come from the tables below; each runs in a process
// of its own, which prints one line of JSON: a hang or a crash fails that cell and no other.
//
// Every cell has a bystander doing the same thing as the subject (a second graph with its own
// worker, or a second worker with its own graph) that none of the events are for, and a sibling
// graph on the subject's thread. What is compared, wherever it applies: the disposed graph heard,
// ticked and received nothing after dispose() (counted in a SharedArrayBuffer, so the main thread
// can still read it when the graph's thread is gone); the workers stopped; the other ends of the
// graph's socket and request saw them close, and its child was killed; terminate() resolved
// (or, for a node:worker_threads worker of a disposed graph, stayed pending: see hostTerminate);
// the bystander, the sibling and the main thread's own server and timer still work; on Linux the
// process's descriptors are back to where they were; and the process then exits by itself, with 0.
import { afterAll, describe, expect, test } from "bun:test";
import { rmSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

const dir = String(
  tempDir("module-graph-workers-", {
    "shared.mjs": String.raw`
      // Slots of the Int32Array every thread of a cell shares; the subject's start at 0, the bystander's at BYSTANDER.
      export const S = { TICKS: 0, HEARD: 1, RECV: 2, DISPOSED: 3, TICKS_AT_DISPOSE: 4, HEARD_AT_DISPOSE: 5, RECV_AT_DISPOSE: 6, LEAF_TICKS: 7, LEAF_STATE: 8, RELEASE: 9, GO: 10, PID: 11, PEER_SEEN: 12, PEER_CLOSED: 13, SIBLING_TICKS: 14 };
      export const BYSTANDER = 16;
      export const LEAF = { ready: 1, inHandler: 2, blocked: 3, exiting: 4 };
      export const turn = () => new Promise(resolve => setImmediate(resolve));
      export const until = async condition => { while (!condition()) await turn(); };
    `,
    "leaf.mjs": String.raw`
      import { parentPort, workerData } from "node:worker_threads";
      import { LEAF, S } from "./shared.mjs";
      const { sab, base, mode } = workerData;
      const i32 = new Int32Array(sab);
      const state = value => { Atomics.store(i32, base + S.LEAF_STATE, value); };
      if (mode === "atomics") {
        state(LEAF.blocked);
        Atomics.wait(i32, base + S.RELEASE, 0);
      } else if (mode === "exit") {
        state(LEAF.exiting);
        process.exit(7);
      } else if (mode === "throwing") {
        state(LEAF.exiting);
        throw new Error("thrown by the graph's worker");
      } else if (mode === "drain") {
        parentPort.postMessage("ready");
      } else {
        parentPort.on("message", message => {
          if (message === "ping") parentPort.postMessage("pong");
          if (message === "spin") {
            state(LEAF.inHandler);
            while (Atomics.load(i32, base + S.RELEASE) === 0);
          }
        });
        setInterval(() => {
          Atomics.add(i32, base + S.LEAF_TICKS, 1);
          if (mode === "flooding") for (let i = 0; i < 20; i++) parentPort.postMessage("flood");
        }, 1);
        state(LEAF.ready);
        parentPort.postMessage("ready");
      }
    `,
    "sibling.mjs": String.raw`
      setInterval(() => control.tick(), 1);
    `,
    "work.mjs": String.raw`
      // The code of the graph. "control" is the host's, through the globals option.
      import fs from "node:fs";
      import { Worker as NodeWorker } from "node:worker_threads";
      const held = control.held;
      export function perform(order) {
        control.performed++;
        if (order === "dispose") control.dispose();
        else if (order === "dispose-inner") { control.snapshot(); held.inner.dispose(); }
        else if (order === "terminate-leaf") Promise.resolve(held.worker.terminate()).then(() => control.hear("terminate resolved"));
        else if (order === "arm") setInterval(() => control.tick(), 1);
        else if (order === "exit") process.exit(3);
        else if (order === "throw") throw new Error("thrown by the graph's code");
      }
      export async function begin(kind, arg) {
        if (kind === "timer") setInterval(() => control.tick(), 1);
        else if (kind === "orders") setInterval(() => { if (control.orders.length) perform(control.orders.shift()); }, 1);
        else if (kind === "readFile") (async () => { for (;;) { await fs.promises.readFile(import.meta.path); control.tick(); } })();
        else if (kind === "fetch") fetch("http://127.0.0.1:" + control.ports.http + "/hang").then(() => control.hear("fetch resolved"), () => control.hear("fetch rejected"));
        else if (kind === "socket" || kind === "dialing" || kind === "connecting") {
          const hears = name => () => control.hear("socket " + name);
          held.socket = undefined;
          Bun.connect({ hostname: "127.0.0.1", port: control.ports.tcp, socket: { data: hears("data"), close: hears("close"), end: hears("end"), error: hears("error"), connectError: hears("connectError") } })
            .then(socket => { held.socket = socket; }, () => control.hear("connect rejected"));
        } else if (kind === "child") {
          const child = Bun.spawn({ cmd: [process.execPath, "-e", "setTimeout(() => {}, 30000)"], stdio: ["ignore", "ignore", "ignore"], onExit: () => control.hear("child onExit") });
          child.exited.then(() => control.hear("child exited"));
          control.pid(child.pid);
        } else if (kind === "handlers") {
          const channel = new BroadcastChannel(control.channel);
          channel.onmessage = () => control.hear("broadcast");
          const { port1, port2 } = new MessageChannel();
          port1.onmessage = () => control.hear("port");
          held.port = port2;
        } else if (kind === "worker") {
          const mode = arg.mode === "starting" || arg.mode === "terminated" ? "idle" : arg.mode;
          const options = { workerData: { sab: control.sab, base: control.base, mode } };
          const onMessage = data => { control.hear("message:" + data); if (control.onLeafMessage) perform(control.onLeafMessage); };
          const onClose = () => { control.hear("close"); if (control.onLeafClose) perform(control.onLeafClose); };
          if (arg.api === "web") {
            const worker = (held.worker = new Worker(import.meta.dir + "/leaf.mjs", options));
            worker.onmessage = event => onMessage(event.data);
            worker.onerror = () => control.hear("error");
            worker.onmessageerror = () => control.hear("messageerror");
            worker.addEventListener("close", onClose);
          } else {
            const worker = (held.worker = new NodeWorker(import.meta.dir + "/leaf.mjs", options));
            worker.on("message", onMessage);
            worker.on("error", () => control.hear("error"));
            worker.on("messageerror", () => control.hear("messageerror"));
            worker.on("exit", onClose);
          }
        } else if (kind === "nested") {
          const inner = (held.inner = new Bun.ModuleGraph({ isolateIO: true, globals: { control } }));
          const app = await inner.import(import.meta.path);
          for (const [innerKind, innerArg] of arg) await inner.run(() => app.begin(innerKind, innerArg));
        } else if (kind === "peer") {
          const talk = port => { port.onmessage = () => control.recv(); setInterval(() => port.postMessage(1), 1); };
          if (arg.transport === "broadcast") talk(new BroadcastChannel(control.channel));
          else if (arg.role === "creator") { const { port1, port2 } = new MessageChannel(); talk(port1); control.sendPort(port2); }
          else held.adopt = talk;
        }
      }
    `,
    "tla.mjs": String.raw`
      import { begin } from "./work.mjs";
      for (const [kind, arg] of control.work) await begin(kind, arg);
      control.began = true;
      // "slow": until the host lets it go, once the cell's events have been issued (through timers of the graph's own).
      if (control.tla === "slow") while (!control.released) await new Promise(resolve => setTimeout(resolve, 1));
      else await new Promise(() => {});
      control.hear("import finished");
    `,
    "host.mjs": String.raw`
      // Runs on the thread that hosts the cell's graph: puts the graph in the cell's state, then issues the cell's events.
      import { AsyncLocalStorage } from "node:async_hooks";
      import fs from "node:fs";
      import { parentPort } from "node:worker_threads";
      import { LEAF, S, turn, until } from "./shared.mjs";

      export async function runHost({ sab, base, ports, channel, cell, onReady }) {
        const i32 = new Int32Array(sab);
        const load = slot => Atomics.load(i32, base + slot);
        const store = (slot, value) => void Atomics.store(i32, base + slot, value);
        const heard = [];
        const out = { heard, heardAtDispose: Infinity };
        let graph, app, terminated;
        const snapshot = () => {
          if (load(S.DISPOSED)) return;
          store(S.TICKS_AT_DISPOSE, load(S.TICKS));
          store(S.HEARD_AT_DISPOSE, load(S.HEARD));
          store(S.RECV_AT_DISPOSE, load(S.RECV));
          store(S.DISPOSED, 1);
          out.heardAtDispose = heard.length;
        };
        const control = {
          sab, base, ports, channel, work: cell.work, tla: cell.graphState === "tla-slow" ? "slow" : "never",
          held: {}, orders: [], performed: 0, began: false, onLeafMessage: undefined, onLeafClose: undefined, released: false,
          tick: () => void Atomics.add(i32, base + S.TICKS, 1),
          recv: () => void Atomics.add(i32, base + S.RECV, 1),
          hear: name => { heard.push(name); Atomics.add(i32, base + S.HEARD, 1); },
          pid: pid => store(S.PID, pid),
          sendPort: port => parentPort.postMessage({ port }, [port]),
          snapshot,
          dispose: () => { snapshot(); graph.dispose(); },
        };
        out.control = control;
        out.dispose = control.dispose;

        const step = name => {
          if (name === "dispose") return control.dispose();
          if (name === "terminate-leaf") {
            out.terminateResolved = false;
            terminated = Promise.resolve(control.held.worker.terminate()).then(() => { out.terminateResolved = true; });
            return;
          }
          if (name.startsWith("order:")) return void control.orders.push(name.slice(6));
          if (name === "orders-performed") return until(() => control.orders.length === 0);
          if (name === "errored") return until(() => out.onError);
          if (name.startsWith("leaf-message:")) {
            control.onLeafMessage = name.slice(13);
            control.held.worker.postMessage("ping");
            return until(() => control.performed > 0);
          }
          if (name.startsWith("leaf-close:")) return void (control.onLeafClose = name.slice(11));
          if (name === "disposed") return until(() => load(S.DISPOSED));
          if (name === "leaf-errored") return until(() => heard.includes("error") && heard.includes("close"));
          if (name === "ticking") return until(() => load(S.TICKS) > 0);
          if (name === "leaf-answers") {
            const from = heard.length;
            control.held.worker.postMessage("ping");
            return until(() => heard.includes("message:pong", from));
          }
          if (name === "immediate") return turn();
          if (name === "timer") return new Promise(resolve => setTimeout(resolve, 1));
          if (name === "settled") return terminated ?? fs.promises.readFile(import.meta.path);
          if (name === "gc") return Bun.gc(true);
          if (name === "wait-go") return void Atomics.wait(i32, base + S.GO, 0);
          if (name === "exit") process.exit(3);
          if (name === "exit-main") { fs.writeSync(1, JSON.stringify({ exited: "main" }) + "\n"); process.exit(0); }
          throw new Error("unknown step " + name);
        };

        // A second graph of this thread's, which none of the cell's events are for.
        const sibling = new Bun.ModuleGraph({ isolateIO: true, globals: { control: { tick: () => void Atomics.add(i32, base + S.SIBLING_TICKS, 1) } } });
        await sibling.import(import.meta.dir + "/sibling.mjs");
        out.disposeSibling = () => sibling.dispose();

        graph = new Bun.ModuleGraph({
          isolateIO: cell.graph !== "plain",
          globals: { control },
          onError: cell.onError && ((error, kind) => { out.onError = kind + ": " + error.message; if (cell.onError !== "record") step(cell.onError); }),
        });

        const inState = async ([kind, arg]) => {
          if (kind === "timer" || kind === "readFile") await until(() => load(S.TICKS) > 0);
          else if (kind === "fetch") await until(() => load(S.PEER_SEEN) > 0);
          else if (kind === "socket") await until(() => load(S.PEER_SEEN) > 0 && control.held.socket);
          // The other end (on the main thread) has accepted; this thread has not been back to its event loop to be told.
          else if (kind === "connecting") Atomics.wait(i32, base + S.PEER_SEEN, 0);
          else if (kind === "child") await until(() => load(S.PID) > 0);
          else if (kind === "peer" && arg.role !== "adopter") await until(() => load(S.RECV) > 0);
          else if (kind === "nested") for (const inner of arg) await inState(inner);
          else if (kind === "handlers") {
            const probe = new BroadcastChannel(channel);
            probe.postMessage(1);
            control.held.port.postMessage(1);
            await until(() => heard.includes("broadcast") && heard.includes("port"));
            probe.close();
          } else if (kind === "worker") {
            const { mode } = arg;
            if (mode === "idle" || mode === "drain" || mode === "handler" || mode === "terminated") await until(() => heard.includes("message:ready"));
            if (mode === "flooding") await until(() => heard.includes("message:flood"));
            if (mode === "handler") { control.held.worker.postMessage("spin"); await until(() => load(S.LEAF_STATE) === LEAF.inHandler); }
            if (mode === "atomics") await until(() => load(S.LEAF_STATE) === LEAF.blocked);
            if (mode === "exit" || mode === "throwing") await until(() => load(S.LEAF_STATE) === LEAF.exiting);
            if (mode === "terminated") { graph.run(() => app.perform("terminate-leaf")); await until(() => heard.includes("terminate resolved")); }
          }
        };

        if (cell.graphState === "tla-never" || cell.graphState === "tla-slow") {
          out.import = graph.import(import.meta.dir + "/tla.mjs");
          out.import.catch(() => {}); // (rejects when the graph is disposed; the cell reads its status)
          await until(() => control.began);
        } else {
          app = await graph.import(import.meta.dir + "/work.mjs");
          // (run() throws once the graph is disposed; a snapshot taken inside it still enters its context.)
          const inGraph = graph.run(() => AsyncLocalStorage.snapshot());
          if (cell.graphState === "disposed") control.dispose();
          for (const [kind, arg] of cell.work) {
            const began = inGraph(() => app.begin(kind, arg));
            if (cell.graphState !== "disposed") await began;
          }
          out.import = Promise.resolve();
        }
        out.adopt = port => graph.run(() => control.held.adopt(port));
        if (cell.graphState !== "disposed") for (const work of cell.work) await inState(work);
        if (cell.graphState === "unreferenced") {
          graph = app = undefined;
          for (let i = 0; i < 3; i++) { Bun.gc(true); await turn(); }
        }
        onReady?.(out);

        for (const name of cell.hostPlan) { const pending = step(name); if (pending) await pending; }
        control.released = true;
        // (A node:worker_threads terminate() of a worker whose graph was disposed first stays pending: its exit is not reported.)
        if (cell.terminate === "resolves") await terminated;

        // A message for a terminated worker, and messages for a disposed graph.
        if (control.held.worker) try { control.held.worker.postMessage("ping"); } catch (error) { out.postThrew = String(error); }
        if (control.held.port) {
          const late = new BroadcastChannel(channel);
          late.postMessage(2);
          control.held.port.postMessage(2);
          late.close();
        }
        return out;
      }
    `,
    "main-shared.mjs": String.raw`
      // What the main thread of every cell has: the peers the graphs' sockets and requests talk to, its own
      // server and timer, and the checks made once the cell's events have been issued.
      import fs from "node:fs";
      import { BYSTANDER, S, turn, until } from "./shared.mjs";

      export function setUp() {
        const sab = new SharedArrayBuffer(4 * 2 * BYSTANDER);
        const i32 = new Int32Array(sab);
        const result = {};
        // Nothing of a finished cell keeps the process running; this says so if something does.
        setTimeout(() => { fs.writeSync(1, JSON.stringify({ stillRunning: true, ...result }) + "\n"); process.exit(1); }, 30000).unref();
        const closers = [];
        const peersOf = base => {
          const seen = () => { Atomics.store(i32, base + S.PEER_SEEN, 1); Atomics.notify(i32, base + S.PEER_SEEN); };
          const closed = () => void Atomics.add(i32, base + S.PEER_CLOSED, 1);
          const http = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch(request) { request.signal.addEventListener("abort", closed); seen(); return new Promise(() => {}); } });
          const tcp = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { open: seen, close: closed, data() {} } });
          closers.push(() => http.stop(true), () => tcp.stop(true));
          return { http: http.port, tcp: tcp.port };
        };
        const ports = { [0]: peersOf(0), [BYSTANDER]: peersOf(BYSTANDER) };
        const hostServer = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("host") });
        let hostTicks = 0;
        const hostTimer = setInterval(() => hostTicks++, 1);
        closers.push(() => hostServer.stop(true), () => clearInterval(hostTimer));
        const load = (base, slot) => Atomics.load(i32, base + slot);
        const fds = () => (process.platform === "linux" ? fs.readdirSync("/proc/self/fd").length : 0);

        // The bystander's graph timer is the clock: it has ticked five more times, so it still works, and
        // anything of the subject's that was going to be heard has had the time to be.
        const quiet = async () => {
          const [from, hostFrom] = [load(BYSTANDER, S.TICKS), hostTicks];
          await until(() => load(BYSTANDER, S.TICKS) >= from + 5 && hostTicks >= hostFrom + 5);
        };
        const siblingTicks = async () => {
          const from = load(0, S.SIBLING_TICKS);
          await until(() => load(0, S.SIBLING_TICKS) >= from + 3);
          return "ticks";
        };
        const stopped = async slot => {
          for (;;) {
            const before = load(0, slot);
            await quiet();
            if (load(0, slot) === before) return true;
          }
        };
        // (Never signal pid 0: that is the whole process group.)
        const killChild = base => { const pid = load(base, S.PID); if (pid > 0) try { process.kill(pid, "SIGKILL"); } catch {} };
        // The other end of the subject's socket or request saw it close. What a disposed graph's code
        // connects is never dialed; "either": the cell does not say whether it got that far.
        const peerClosed = async either => {
          if (load(0, S.PEER_SEEN) === 0) return either ? true : "never dialed";
          await until(() => load(0, S.PEER_CLOSED) > 0);
          return true;
        };
        // A child that was killed is gone, or a zombie where the thread that would have reaped it was
        // terminated first (as it is for a worker that kills its own child and is terminated). Only
        // /proc tells the two apart: elsewhere this waits only where somebody is left to reap it.
        const pidGone = async reaped => {
          const pid = load(0, S.PID);
          if (pid <= 0) return false;
          const running = () => {
            if (process.platform === "linux") try { return fs.readFileSync("/proc/" + pid + "/stat", "utf8").split(") ")[1][0] !== "Z"; } catch { return false; }
            try { process.kill(pid, 0); return reaped; } catch { return false; }
          };
          await until(() => !running());
          return true;
        };
        // (A bystander in a readFile loop has a descriptor open half the time: any sample at the baseline will do.)
        const fdsAbove = async baseline => {
          if (process.platform !== "linux") return 0;
          for (const deadline = Date.now() + 1000; Date.now() < deadline; await turn()) if (fds() <= baseline) return 0;
          return fds() - baseline;
        };
        const disposed = () => load(0, S.DISPOSED) === 1;
        // What the subject's graph heard, ticked and received since it was disposed.
        const afterDispose = () => ({
          heard: disposed() ? load(0, S.HEARD) - load(0, S.HEARD_AT_DISPOSE) : 0,
          ticks: disposed() ? load(0, S.TICKS) - load(0, S.TICKS_AT_DISPOSE) : 0,
          received: disposed() ? load(0, S.RECV) - load(0, S.RECV_AT_DISPOSE) : 0,
        });
        // The terminal events heard, each once. (Not 'error': whether a worker that throws as it is terminated gets to report it is a race.)
        const names = heard => [...new Set(heard.filter(name => !name.startsWith("message:") && name !== "error"))].sort();
        const finish = () => {
          for (const close of closers) close();
          fs.writeSync(1, JSON.stringify(result) + "\n");
        };
        return { sab, i32, ports, result, load, fds, quiet, siblingTicks, stopped, peerClosed, pidGone, killChild, fdsAbove, disposed, afterDispose, names, finish, hostServer };
      }
    `,
    "a.mjs": String.raw`
      // Topology A: a graph on the main thread whose code starts a worker.
      import { runHost } from "./host.mjs";
      import { setUp } from "./main-shared.mjs";
      import { BYSTANDER, S, until } from "./shared.mjs";

      const cell = JSON.parse(process.argv[2]);
      const main = setUp();
      const { result } = main;
      const idle = ([kind, arg]) => (kind === "worker" ? [kind, { ...arg, mode: "idle" }] : [kind, arg]);
      const bystander = await runHost({
        sab: main.sab, base: BYSTANDER, ports: main.ports[BYSTANDER], channel: "bystander",
        cell: { graphState: "idle", work: [["timer"], ...cell.work.map(idle)], hostPlan: [] },
      });
      const baseline = main.fds();

      const subject = await runHost({ sab: main.sab, base: 0, ports: main.ports[0], channel: "subject", cell });
      result.planned = true;
      // What a live graph is due to hear (its worker's exit), it hears; a disposed one gets the time to.
      if (!main.disposed()) await until(() => cell.hears.every(name => subject.heard.includes(name)));
      await main.quiet();
      const kinds = cell.work.map(([kind]) => kind);
      Object.assign(result, {
        disposed: main.disposed(),
        heard: main.disposed() ? null : main.names(subject.heard),
        terminateResolved: cell.terminate === "either" ? "either" : (subject.terminateResolved ?? null),
        onError: subject.onError ?? null,
        postThrew: subject.postThrew ?? null,
        import: Bun.peek.status(subject.import),
      });
      result.sibling = await main.siblingTicks();
      subject.disposeSibling();
      // Whatever the cell did, the graph is disposed in the end; none of it may hear that either.
      if (cell.graphState !== "unreferenced") subject.dispose();
      result.leafStopped = await main.stopped(S.LEAF_TICKS);
      result.graphStopped = await main.stopped(S.TICKS);
      if (kinds.includes("child")) result.childGone = await main.pidGone(true);
      if (kinds.some(kind => ["fetch", "socket", "dialing"].includes(kind))) result.peerClosed = await main.peerClosed(kinds.includes("dialing"));
      await main.quiet();
      // (A graph without isolateIO owns nothing: what its code opened is the host's, and goes on.)
      result.afterDispose = cell.graph === "plain" ? "not isolated" : main.afterDispose();
      // (Named, when there is something to name.)
      if (cell.graph !== "plain" && subject.heard.length > subject.heardAtDispose) result.heardAfterDispose = subject.heard.slice(subject.heardAtDispose);
      result.fdsAboveBaseline = await main.fdsAbove(baseline);

      bystander.control.held.worker.postMessage("ping");
      await until(() => bystander.heard.includes("message:pong"));
      result.bystander = "answers";
      result.hostServer = await fetch("http://127.0.0.1:" + main.hostServer.port + "/").then(response => response.text());
      bystander.dispose();
      bystander.disposeSibling();
      main.finish();
    `,
    "b-worker.mjs": String.raw`
      // A worker that hosts the cell's graph.
      import { parentPort, workerData } from "node:worker_threads";
      import { runHost } from "./host.mjs";
      import { S, until } from "./shared.mjs";
      let host;
      const report = stage => parentPort.postMessage({ stage, heard: host.heard, late: host.heard.slice(host.heardAtDispose), onError: host.onError ?? null, terminateResolved: host.terminateResolved ?? null });
      parentPort.on("message", message => {
        if (message === "ping") parentPort.postMessage("pong");
        // What a live graph is due to hear (its worker's exit), it hears.
        else if (message === "report") until(() => Atomics.load(new Int32Array(workerData.sab), workerData.base + S.DISPOSED) || workerData.cell.hears.every(name => host.heard.includes(name))).then(() => report("report"));
        else if (message.port) host.adopt(message.port);
      });
      await runHost({ ...workerData, onReady: out => { host = out; parentPort.postMessage({ stage: "ready" }); } });
      report("done");
    `,
    "b.mjs": String.raw`
      // Topologies B to E: a worker hosts the graph; the main thread issues its share of the cell's events.
      import fs from "node:fs";
      import { Worker as NodeWorker } from "node:worker_threads";
      import { setUp } from "./main-shared.mjs";
      import { BYSTANDER, S, turn, until } from "./shared.mjs";

      const cell = JSON.parse(process.argv[2]);
      const main = setUp();
      const { result } = main;

      function host(base, channel, hostCell) {
        const options = { workerData: { sab: main.sab, base, ports: main.ports[base], channel, cell: hostCell } };
        const seen = { stages: [], pongs: 0, exit: undefined, error: null, reported: null, port: undefined };
        const onMessage = message => {
          if (message === "pong") seen.pongs++;
          else if (message.port) seen.port = message.port;
          else { seen.stages.push(message.stage); seen.reported = message; }
        };
        let worker;
        if (cell.hostApi === "web") {
          worker = new Worker(import.meta.dir + "/b-worker.mjs", options);
          worker.onmessage = event => onMessage(event.data);
          worker.onerror = event => { seen.error = event.message; };
          worker.addEventListener("close", event => { seen.exit = event.code; });
        } else {
          worker = new NodeWorker(import.meta.dir + "/b-worker.mjs", options);
          worker.on("message", onMessage);
          worker.on("error", error => { seen.error = error.message; });
          worker.on("exit", code => { seen.exit = code; });
        }
        const answers = async () => { const from = seen.pongs; worker.postMessage("ping"); await until(() => seen.pongs > from); return "answers"; };
        return { worker, seen, answers };
      }

      const idle = ([kind, arg]) => (kind === "worker" ? [kind, { ...arg, mode: "idle" }] : kind === "peer" ? [kind, { ...arg, role: "adopter" }] : [kind, arg]);
      const bystander = host(BYSTANDER, cell.channel ?? "bystander", { graphState: "idle", work: [["timer"], ...cell.work.map(idle)], hostPlan: [] });
      await until(() => bystander.seen.stages.includes("done"));
      const baseline = main.fds();

      const subject = host(0, cell.channel ?? "subject", cell);
      // A port the subject's graph made goes to the bystander's graph.
      if (JSON.stringify(cell.work).includes('"port"')) until(() => subject.seen.port).then(() => bystander.worker.postMessage({ port: subject.seen.port }, [subject.seen.port]));
      let terminated;
      for (const name of cell.mainPlan) {
        if (name === "ready" || name === "done") await until(() => subject.seen.stages.includes(name) || subject.seen.exit !== undefined);
        else if (name === "terminate") { result.terminateResolved = false; terminated = Promise.resolve(subject.worker.terminate()).then(() => { result.terminateResolved = true; }); }
        else if (name === "go") { Atomics.store(main.i32, S.GO, 1); Atomics.notify(main.i32, S.GO); }
        else if (name === "immediate") await turn();
        else if (name === "timer") await new Promise(resolve => setTimeout(resolve, 1));
        else if (name === "settled") await terminated;
        else if (name === "exit-main") { main.killChild(0); main.killChild(BYSTANDER); fs.writeSync(1, JSON.stringify({ exited: "main" }) + "\n"); process.exit(0); }
        else throw new Error("unknown step " + name);
      }
      await terminated;
      result.planned = true;

      if (cell.worker === "alive") {
        result.worker = await subject.answers();
        result.sibling = await main.siblingTicks();
        await main.quiet();
        subject.worker.postMessage("report");
        await until(() => subject.seen.stages.includes("report"));
        const { heard, late, onError, terminateResolved } = subject.seen.reported;
        // (Named, when there is something to name.)
        if (late.length) result.heardAfterDispose = late;
        Object.assign(result, { heard: main.disposed() ? null : main.names(heard), onError, leafTerminateResolved: cell.terminate === "either" ? "either" : terminateResolved });
        // (A graph without isolateIO owns nothing: the graph its code made goes on when it is disposed.)
        if (cell.innerSurvives) result.innerSurvives = (await until(() => main.afterDispose().ticks > 5), true);
        await subject.worker.terminate();
      } else {
        await until(() => subject.seen.exit !== undefined);
        // (The 'close' code of a terminated web Worker is 0 or 1, by what it had running.)
        result.worker = cell.worker === "terminated" ? "exited" : "exit " + subject.seen.exit;
        try { subject.worker.postMessage("ping"); } catch (error) { result.postThrew = String(error); }
      }
      // (A web Worker's 'error' event carries the formatted error, source lines and all.)
      result.error = subject.seen.error?.includes("thrown by the graph's code") ? "thrown by the graph's code" : subject.seen.error;
      if (!cell.racy) result.disposed = main.disposed();
      const kinds = JSON.stringify(cell.work);
      result.leafStopped = await main.stopped(S.LEAF_TICKS);
      result.graphStopped = await main.stopped(S.TICKS);
      result.peerStopped = await main.stopped(S.RECV);
      if (kinds.includes('"child"')) { result.childGone = !main.disposed() || (await main.pidGone(cell.worker === "alive")); main.killChild(0); }
      if (/"(fetch|socket|connecting)"/.test(kinds)) result.peerClosed = await main.peerClosed(cell.racy);
      await main.quiet();
      result.afterDispose = cell.innerSurvives ? { ...main.afterDispose(), ticks: 0 } : main.afterDispose();
      result.fdsAboveBaseline = await main.fdsAbove(baseline);
      result.bystander = await bystander.answers();
      result.hostServer = await fetch("http://127.0.0.1:" + main.hostServer.port + "/").then(response => response.text());
      await bystander.worker.terminate();
      main.killChild(BYSTANDER);
      main.finish();
    `,
  }),
);
afterAll(() => rmSync(dir, { recursive: true, force: true }));

type Work = [kind: string, arg?: unknown];
type Cell = {
  name: string;
  script: "a.mjs" | "b.mjs";
  cell: Record<string, unknown>;
  expected: Record<string, unknown>;
};
const cells: Record<string, Cell[]> = {};
const add = (topology: string, cell: Cell) => void (cells[topology] ??= []).push(cell);

const apis = ["web", "node"] as const;
type Api = (typeof apis)[number];
// The state of the worker a graph's code started, when the event lands. "handler": spinning inside its
// message handler; "atomics": blocked in Atomics.wait (only terminate() ends either). "flooding":
// posting twenty messages a millisecond, so some are always on their way to the graph. "exit": calling
// process.exit(7); "throwing": throwing at its top level; "drain": nothing left to keep it running. "terminated": the graph's code already did.
const leafStates = [
  "starting",
  "idle",
  "flooding",
  "handler",
  "atomics",
  "exit",
  "throwing",
  "drain",
  "terminated",
] as const;
type LeafState = (typeof leafStates)[number];
const gaps = { "in the same turn": [], "after setImmediate": ["immediate"], "after a 1ms timer": ["timer"] };
const silent = { heard: 0, ticks: 0, received: 0 };
const thrown = "uncaughtException: thrown by the graph's code";
const orders: Work[] = [["orders"]];

// What the host's own terminate() of the graph's worker does. A web Worker's returns nothing. A
// node:worker_threads one resolves on the worker's exit, which the worker of a disposed graph
// reports to nobody, the host included (like the `exited` of a Subprocess the graph spawned): it
// stays pending unless the exit was reported before dispose() ("either" where the two race).
function hostTerminate(api: Api, leaf: LeafState, plan: string[], graphState?: string) {
  const [terminate, dispose] = [plan.indexOf("terminate-leaf"), plan.indexOf("dispose")];
  if (terminate < 0) return undefined;
  if (api === "web") return "resolves";
  if (graphState === "disposed") return "pending";
  if (dispose < 0 || leaf === "terminated" || plan.includes("settled")) return "resolves";
  if (leaf === "exit" || leaf === "throwing" || leaf === "drain") return "either";
  return terminate > dispose || dispose === terminate + 1 ? "pending" : "either";
}
const resolved = (terminate: ReturnType<typeof hostTerminate>) =>
  terminate === undefined ? null : terminate === "either" ? "either" : terminate === "resolves";
// The terminal events a graph that is not disposed hears, each once ("close" stands for node's 'exit' too).
function hears(
  leaf: { mode: LeafState } | undefined,
  plan: string[],
  kinds: string,
  graphState?: string,
  onError?: string,
) {
  const heard = new Set<string>();
  // An import suspended on something slow finishes once that does, if the graph was not disposed meanwhile.
  if (graphState === "tla-slow") heard.add("import finished");
  if (
    leaf &&
    (plan.some(step => step.endsWith("terminate-leaf")) ||
      onError === "terminate-leaf" ||
      ["terminated", "exit", "throwing", "drain"].includes(leaf.mode))
  )
    heard.add("close");
  if (plan.includes("order:terminate-leaf") || leaf?.mode === "terminated") heard.add("terminate resolved");
  if (kinds.includes('"handlers"')) heard.add("broadcast").add("port");
  return [...heard].sort();
}
const peers = (kinds: string, graphState?: string, racy?: boolean) => ({
  ...(kinds.includes('"child"') && { childGone: true }),
  // (What a disposed graph's code connects is never dialed.)
  ...(/"(fetch|socket|dialing|connecting)"/.test(kinds) && {
    peerClosed: graphState === "disposed" && !racy ? "never dialed" : true,
  }),
});

// ── A: a graph on the main thread whose code starts a worker ──────────────────────────────────────
type OwnerCell = {
  graphState?: string;
  graph?: string;
  work?: Work[];
  hostPlan: string[];
  onError?: string;
  terminate?: "either";
};
function a(name: string, api: Api, mode: LeafState, cell: OwnerCell) {
  // (onError's terminate() is the host's too, issued where the error was thrown.)
  const terminate =
    cell.terminate ??
    hostTerminate(
      api,
      mode,
      cell.onError === "terminate-leaf" ? ["terminate-leaf", ...cell.hostPlan.slice(2)] : cell.hostPlan,
      cell.graphState,
    );
  const disposes =
    cell.hostPlan.some(step => step.endsWith("dispose")) ||
    cell.graphState === "disposed" ||
    cell.onError === "dispose";
  const work: Work[] = [...(cell.work ?? []), ["worker", { api, mode }]];
  const heard = hears({ mode }, cell.hostPlan, JSON.stringify(work), cell.graphState, cell.onError);
  add("A: a graph on the main thread whose code starts a worker", {
    name,
    script: "a.mjs",
    cell: { graphState: "idle", ...cell, work, terminate, hears: heard },
    expected: cell.hostPlan.includes("exit-main")
      ? { exited: "main" }
      : {
          planned: true,
          disposed: disposes,
          heard: disposes ? null : heard,
          terminateResolved: resolved(terminate),
          onError: cell.onError ? thrown : null,
          postThrew: null,
          // Parked in a top-level await when its graph is disposed, the host's import() rejects
          // (a graph without a context discards nothing, and leaves it to finish).
          import:
            (cell.graphState === "tla-never" || cell.graphState === "tla-slow") && disposes && cell.graph !== "plain"
              ? "rejected"
              : cell.graphState === "tla-never" || (cell.graphState === "tla-slow" && disposes)
                ? "pending"
                : "fulfilled",
          sibling: "ticks",
          leafStopped: true,
          graphStopped: true,
          ...peers(JSON.stringify(work), cell.graphState),
          afterDispose: cell.graph === "plain" ? "not isolated" : silent,
          fdsAboveBaseline: 0,
          bystander: "answers",
          hostServer: "host",
        },
  });
}

leafStates.forEach((leaf, i) => {
  const either = apis[i % 2];
  for (const api of apis) {
    const at = `${api} Worker ${leaf}: `;
    a(at + "dispose()", api, leaf, { hostPlan: ["dispose"] });
    a(at + "the host terminates it", api, leaf, { hostPlan: ["terminate-leaf"] });
    a(at + "the graph's code terminates it", api, leaf, {
      work: orders,
      hostPlan: ["order:terminate-leaf", "orders-performed"],
    });
    a(at + "dispose(), then terminate() in the same turn", api, leaf, { hostPlan: ["dispose", "terminate-leaf"] });
    a(at + "terminate(), then dispose() in the same turn", api, leaf, { hostPlan: ["terminate-leaf", "dispose"] });
  }
  const at = `${either} Worker ${leaf}: `;
  a(at + "the graph's code disposes its graph", either, leaf, {
    work: orders,
    hostPlan: ["order:dispose", "orders-performed"],
  });
  a(at + "the graph's code terminates it, then dispose() in the same turn", either, leaf, {
    work: orders,
    hostPlan: ["order:terminate-leaf", "orders-performed", "dispose"],
  });
  a(at + "terminate(), then dispose() once it resolved", either, leaf, {
    hostPlan: ["terminate-leaf", "settled", "dispose"],
  });
  a(at + "dispose() and a collection in the same turn", either, leaf, { hostPlan: ["dispose", "gc"] });
  a(at + "process.exit() on the main thread", either, leaf, { hostPlan: ["exit-main"] });
  if (leaf === "starting" || leaf === "idle" || leaf === "atomics" || leaf === "exit")
    for (const [gap, steps] of Object.entries(gaps).slice(1)) {
      a(at + `dispose(), then terminate() ${gap}`, either, leaf, { hostPlan: ["dispose", ...steps, "terminate-leaf"] });
      a(at + `terminate(), then dispose() ${gap}`, either, leaf, { hostPlan: ["terminate-leaf", ...steps, "dispose"] });
    }
});
for (const api of apis) {
  for (const leaf of ["starting", "idle", "flooding"] as const)
    a(`${api} Worker ${leaf}: the graph disposes itself from the worker's message handler`, api, leaf, {
      hostPlan: ["leaf-message:dispose"],
    });
  // (Whether a node Worker's exit reaches the host's terminate() before its 'exit' listeners run is not pinned down.)
  for (const leaf of ["idle", "atomics"] as const)
    a(
      `${api} Worker ${leaf}: terminate(), and the graph disposes itself from the worker's ${api === "web" ? "close" : "exit"} handler`,
      api,
      leaf,
      {
        hostPlan: ["leaf-close:dispose", "terminate-leaf", "disposed"],
        terminate: api === "node" ? "either" : undefined,
      },
    );
  a(`${api} Worker throwing: the graph hears its 'error' and its exit, then dispose()`, api, "throwing", {
    hostPlan: ["leaf-errored", "dispose"],
  });
  // The graph's handlers of its worker's events run in the graph's context: the interval one arms is the graph's, and an error one throws is too.
  a(`${api} Worker idle: the graph's message handler arms an interval, then dispose()`, api, "idle", {
    hostPlan: ["leaf-message:arm", "ticking", "dispose"],
  });
  a(
    `${api} Worker idle: terminate(), the graph's ${api === "web" ? "close" : "exit"} handler arms an interval, then dispose()`,
    api,
    "idle",
    { hostPlan: ["leaf-close:arm", "terminate-leaf", "ticking", "dispose"] },
  );
  a(`${api} Worker idle: the graph's message handler throws, onError records it`, api, "idle", {
    onError: "record",
    hostPlan: ["leaf-message:throw", "errored"],
  });
  // A graph without isolateIO owns nothing: the worker is the host's, and answers after dispose().
  a(
    `${api} Worker idle, graph without isolateIO: dispose() leaves the worker running; terminate() ends it`,
    api,
    "idle",
    { graph: "plain", hostPlan: ["dispose", "leaf-answers", "terminate-leaf", "settled"] },
  );
  // An error thrown by the graph's code, and what its onError does about it.
  for (const onError of ["record", "terminate-leaf", "dispose"])
    for (const then of [[], ["dispose"]])
      a(
        `${api} Worker idle: the graph's code throws, onError: ${onError}${then.length ? ", then dispose() in the same turn" : ""}`,
        api,
        "idle",
        { work: orders, onError, hostPlan: ["order:throw", "errored", ...then] },
      );
}

// The graph's own state when the event lands.
const graphStates: Record<string, { graphState?: string; work?: Work[] }> = {
  "mid-import, in a top-level await that never resolves": { graphState: "tla-never" },
  "mid-import, in a top-level await on a slow timer": { graphState: "tla-slow" },
  "an interval running": { work: [["timer"]] },
  "a readFile loop running": { work: [["readFile"]] },
  "a fetch() waiting for a response": { work: [["fetch"]] },
  "a connected socket": { work: [["socket"]] },
  "a child process running": { work: [["child"]] },
  "handlers waiting for messages": { work: [["handlers"]] },
  "been disposed already": { graphState: "disposed", work: [["timer"], ["socket"]] },
  "been dropped by the host and collected": { graphState: "unreferenced" },
};
Object.entries(graphStates).forEach(([state, shape], i) =>
  Object.entries({
    "dispose()": ["dispose"],
    "terminate()": ["terminate-leaf"],
    "dispose(), then terminate() in the same turn": ["dispose", "terminate-leaf"],
    "terminate(), then dispose() in the same turn": ["terminate-leaf", "dispose"],
  }).forEach(([event, hostPlan], j) => {
    // (Nobody has the collected graph to dispose it; its worker is what ends it.)
    if (shape.graphState === "unreferenced" && hostPlan.includes("dispose")) return;
    const api = apis[(i + j) % 2];
    a(`the graph has ${state}, its ${api} Worker is idle: ${event}`, api, "idle", { ...shape, hostPlan });
  }),
);

// dispose() in the turn the graph's code called Bun.connect().
["dispose", "terminate-leaf"].forEach((step, i) =>
  a(
    `the graph has a Bun.connect() still in flight, its ${apis[i]} Worker is starting: ${step === "dispose" ? "dispose()" : "terminate()"}`,
    apis[i],
    "starting",
    { work: [["dialing"]], hostPlan: [step] },
  ),
);

// ── B to E: a worker hosts the graph ──────────────────────────────────────────────────────────────
type HostedCell = {
  graphState?: string;
  graph?: string;
  work?: Work[];
  hostPlan?: string[];
  mainPlan: string[];
  onError?: string;
  racy?: boolean;
  channel?: string;
  innerSurvives?: boolean;
};
type Ends = "alive" | "terminated" | "exited" | "threw" | "main exits";
function b(topology: string, name: string, hostApi: Api, cell: HostedCell, ends: Ends) {
  const hostPlan = cell.hostPlan ?? [];
  const work = cell.work ?? [];
  const kinds = JSON.stringify(work);
  const disposes =
    hostPlan.some(step => step.endsWith("dispose") || step.endsWith("dispose-inner")) ||
    cell.graphState === "disposed" ||
    cell.onError === "dispose";
  const leaf = work.flatMap(([kind, arg]) => (kind === "worker" ? [arg as { api: Api; mode: LeafState }] : []))[0];
  const heard = hears(leaf, hostPlan, kinds, cell.graphState);
  const terminate = leaf && hostTerminate(leaf.api, leaf.mode, hostPlan, cell.graphState);
  add(topology, {
    name,
    script: "b.mjs",
    cell: {
      hostApi,
      graphState: "idle",
      ...cell,
      work,
      hostPlan,
      worker: ends === "alive" ? "alive" : ends === "terminated" ? "terminated" : "gone",
      terminate,
      hears: heard,
    },
    expected:
      ends === "main exits"
        ? { exited: "main" }
        : {
            planned: true,
            ...(cell.mainPlan.includes("terminate") && { terminateResolved: true }),
            worker:
              ends === "alive" ? "answers" : ends === "terminated" ? "exited" : "exit " + (ends === "exited" ? 3 : 1),
            ...(ends === "alive" && {
              sibling: "ticks",
              heard: disposes ? null : heard,
              onError: cell.onError ? thrown : null,
              leafTerminateResolved: resolved(terminate),
            }),
            error: ends === "threw" ? "thrown by the graph's code" : null,
            ...(!cell.racy && { disposed: disposes }),
            leafStopped: true,
            graphStopped: true,
            peerStopped: true,
            ...peers(kinds, cell.graphState, cell.racy),
            ...(cell.innerSurvives && { innerSurvives: true }),
            afterDispose: silent,
            fdsAboveBaseline: 0,
            bystander: "answers",
            hostServer: "host",
          },
  });
}

// `orders`: issued by the graph's own code, from a timer of its own (so the graph has to be able to
// run one). `needsGraph`: needs somebody to still have the graph. `racy`: where the event lands is
// not known, so only what holds wherever it lands is compared.
type HostedEvent = {
  hostPlan?: string[];
  mainPlan: string[];
  ends: Ends;
  onError?: string;
  orders?: true;
  needsGraph?: true;
  racy?: true;
};
const hostedEvents: Record<string, HostedEvent> = {
  "the main thread terminates the worker": { mainPlan: ["ready", "terminate"], ends: "terminated" },
  "the main thread terminates the worker in the turn it made it": {
    mainPlan: ["terminate"],
    ends: "terminated",
    racy: true,
  },
  "the main thread terminates the worker a setImmediate after making it": {
    mainPlan: ["immediate", "terminate"],
    ends: "terminated",
    racy: true,
  },
  "the main thread terminates the worker a 1ms timer after making it": {
    mainPlan: ["timer", "terminate"],
    ends: "terminated",
    racy: true,
  },
  "the worker disposes the graph": { hostPlan: ["dispose"], mainPlan: ["done"], ends: "alive", needsGraph: true },
  "the graph's code disposes its graph": {
    hostPlan: ["order:dispose", "orders-performed"],
    mainPlan: ["done"],
    ends: "alive",
    orders: true,
    needsGraph: true,
  },
  "process.exit() in the worker": { hostPlan: ["exit"], mainPlan: ["ready"], ends: "exited" },
  "process.exit() in the graph's code": {
    hostPlan: ["order:exit", "errored"],
    mainPlan: ["ready"],
    ends: "exited",
    orders: true,
  },
  "process.exit() on the main thread": { mainPlan: ["ready", "exit-main"], ends: "main exits" },
  "the graph's code throws, onError records it": {
    hostPlan: ["order:throw", "errored"],
    mainPlan: ["done"],
    ends: "alive",
    onError: "record",
    orders: true,
  },
  "the graph's code throws, onError disposes the graph, then the main thread terminates the worker": {
    hostPlan: ["order:throw", "errored"],
    mainPlan: ["done", "terminate"],
    ends: "terminated",
    onError: "dispose",
    orders: true,
    needsGraph: true,
  },
  "the graph's code throws and there is no onError": {
    hostPlan: ["order:throw", "errored"],
    mainPlan: ["ready"],
    ends: "threw",
    orders: true,
  },
  "the worker disposes the graph, then the main thread terminates the worker in the same turn": {
    hostPlan: ["dispose"],
    mainPlan: ["done", "terminate"],
    ends: "terminated",
    needsGraph: true,
  },
  "the worker disposes the graph, then the main thread terminates the worker after setImmediate": {
    hostPlan: ["dispose"],
    mainPlan: ["done", "immediate", "terminate"],
    ends: "terminated",
    needsGraph: true,
  },
  "the worker disposes the graph, then the main thread terminates the worker after a 1ms timer": {
    hostPlan: ["dispose"],
    mainPlan: ["done", "timer", "terminate"],
    ends: "terminated",
    needsGraph: true,
  },
  // The worker is blocked in Atomics.wait and disposes the moment it is woken; terminate() is issued in the same turn as the wake-up.
  "terminate(), then the worker is woken to dispose the graph": {
    hostPlan: ["wait-go", "dispose"],
    mainPlan: ["ready", "terminate", "go"],
    ends: "terminated",
    racy: true,
    needsGraph: true,
  },
  "the worker is woken to dispose the graph, then terminate()": {
    hostPlan: ["wait-go", "dispose"],
    mainPlan: ["ready", "go", "terminate"],
    ends: "terminated",
    racy: true,
    needsGraph: true,
  },
};
function hosted(
  topology: string,
  prefix: string,
  shape: { graphState?: string; graph?: string; work?: Work[] },
  events: string[],
  apiOffset: number,
  extra: Partial<HostedCell> = {},
) {
  events.forEach((event, i) => {
    const { hostPlan, mainPlan, ends, onError, orders: needsOrders, needsGraph, racy } = hostedEvents[event];
    if (shape.graphState === "disposed" && needsOrders) return;
    if (shape.graphState === "unreferenced" && needsGraph) return;
    const hostApi = apis[(i + apiOffset) % 2];
    b(
      topology,
      `${prefix}, in a ${hostApi} Worker: ${event}`,
      hostApi,
      {
        ...shape,
        ...extra,
        work: [...(needsOrders ? orders : []), ...(shape.work ?? [])],
        hostPlan,
        mainPlan,
        onError,
        racy,
      },
      ends,
    );
  });
}

const B = "B: a worker hosts the graph";
const everyEvent = Object.keys(hostedEvents);
const commonEvents = everyEvent.filter(event => !/after|making it|woken/.test(event));
Object.entries({
  "nothing open": {},
  ...graphStates,
  "been dropped by the worker and collected": { graphState: "unreferenced", work: [["timer"]] as Work[] },
})
  .filter(([state]) => state !== "been dropped by the host and collected")
  .forEach(([state, shape], i) =>
    hosted(
      B,
      `the graph has ${state}`,
      shape,
      /nothing|interval|connected socket|child/.test(state) ? everyEvent : commonEvents,
      i,
    ),
  );
// dispose() lands between the other end accepting the graph's connection and the graph being told.
hosted(
  B,
  "the graph has a socket the other end has accepted and it has not been told of",
  { work: [["connecting"]] },
  ["the main thread terminates the worker", "the worker disposes the graph", "process.exit() in the worker"],
  0,
);

const C = "C: a worker hosts a graph whose code starts a worker";
const nestedEvents = [
  "the main thread terminates the worker",
  "the worker disposes the graph",
  "process.exit() in the worker",
  "the worker disposes the graph, then the main thread terminates the worker in the same turn",
  "terminate(), then the worker is woken to dispose the graph",
];
leafStates.forEach((mode, i) => {
  const [api, hostApi] = [apis[i % 2], apis[(i >> 1) % 2]];
  const work: Work[] = [["worker", { api, mode }]];
  hosted(
    C,
    `the graph's ${api} Worker is ${mode}`,
    { work },
    [...nestedEvents, "process.exit() on the main thread"],
    i,
  );
  b(
    C,
    `the graph's ${api} Worker is ${mode}, in a ${hostApi} Worker: the worker terminates the graph's worker`,
    hostApi,
    { work, hostPlan: ["terminate-leaf"], mainPlan: ["done"] },
    "alive",
  );
  if (mode === "idle") {
    b(
      C,
      `the graph's ${api} Worker is idle, in a ${hostApi} Worker: the graph's message handler arms an interval, then the worker disposes the graph`,
      hostApi,
      { work, hostPlan: ["leaf-message:arm", "ticking", "dispose"], mainPlan: ["done"] },
      "alive",
    );
    b(
      C,
      `the graph's ${api} Worker is idle, in a ${hostApi} Worker: the graph's message handler throws, onError records it`,
      hostApi,
      { work, onError: "record", hostPlan: ["leaf-message:throw", "errored"], mainPlan: ["done"] },
      "alive",
    );
  }
  b(
    C,
    `the graph's ${api} Worker is ${mode}, in a ${hostApi} Worker: the graph's code terminates its worker`,
    hostApi,
    { work: [...orders, ...work], hostPlan: ["order:terminate-leaf", "orders-performed"], mainPlan: ["done"] },
    "alive",
  );
});

const D = "D: a graph in a worker makes a graph of its own, which does the opening";
const innerWork: Record<string, Work> = {
  "an interval": ["timer"],
  "a connected socket": ["socket"],
  "a fetch() waiting": ["fetch"],
  "a child process": ["child"],
  "a web Worker": ["worker", { api: "web", mode: "idle" }],
};
Object.entries(innerWork).forEach(([what, inner], i) => {
  hosted(D, `the inner graph has ${what}`, { work: [["nested", [inner]]] }, nestedEvents, i);
  b(
    D,
    `the inner graph has ${what}, in a ${apis[i % 2]} Worker: the outer graph's code disposes the inner graph`,
    apis[i % 2],
    {
      work: [...orders, ["nested", [inner]]],
      hostPlan: ["order:dispose-inner", "orders-performed"],
      mainPlan: ["done"],
    },
    "alive",
  );
});
b(
  D,
  "the outer graph is without isolateIO, the inner one has an interval, in a web Worker: the worker disposes the outer graph and the inner one goes on",
  "web",
  { graph: "plain", work: [["nested", [["timer"]]]], hostPlan: ["dispose"], mainPlan: ["done"], innerSurvives: true },
  "alive",
);

// The events land on one; the other goes on sending to it.
const E = "E: two workers, a graph in each, talking to each other";
for (const [i, transport] of ["broadcast", "port"].entries())
  hosted(
    E,
    `over a ${transport === "port" ? "MessagePort one graph made and the other was sent" : "BroadcastChannel"}`,
    { work: [["peer", { transport, role: "creator" }]] },
    [
      ...nestedEvents,
      "the graph's code disposes its graph",
      "process.exit() in the graph's code",
      "the worker is woken to dispose the graph, then terminate()",
    ],
    i,
    { channel: "peers" },
  );

for (const [topology, list] of Object.entries(cells))
  describe.concurrent("ModuleGraph and workers, " + topology, () => {
    for (const { name, script, cell, expected } of list)
      test(name, async () => {
        await using proc = Bun.spawn({
          cmd: [bunExe(), join(dir, script), JSON.stringify(cell)],
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        const results = stdout
          .split("\n")
          .filter(Boolean)
          .map(line => {
            try {
              return JSON.parse(line);
            } catch {
              return line;
            }
          });
        const [got, want] = [
          { results, exitCode },
          { results: [expected], exitCode: 0 },
        ];
        // (stderr is there to say why a cell failed; a worker that throws prints there in cells that pass.)
        expect(Bun.deepEquals(got, want) ? got : { ...got, stderr }).toEqual(want);
      });
  });
