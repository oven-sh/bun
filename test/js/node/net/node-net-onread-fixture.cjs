// One cell = one client with the `onread` option that receives five 4-byte slices, then EOF.
// A cell is named transport/shape/consumer/when/ret:
//   transport net.connect ("tcp") or tls.connect ("tls")
//   shape     how the bytes arrive: all at once ("burst"), or the next slice once the callback saw the previous one ("paced")
//   consumer  what else touches the stream's read side (a listener, pause(), resume(), read())
//   when      when the consumer attaches: right after connect() ("sync"), in 'connect' ('secureConnect' for tls), or
//             inside the first callback
//   ret       what the second callback returns: undefined, or false followed by a read() or a resume() once nothing moves
// runCell() resolves to the order in which the callbacks and events happened.
//
// `node node-net-onread-fixture.cjs` prints the trace of every cell as JSON. node-net-onread.node-traces.json is that
// output from node v26.3.0. Nothing in here waits for time to pass: a step that has to happen "later" runs once the
// server has flushed its writes and the trace has not moved for IDLE_TURNS turns of the event loop.
"use strict";
const net = require("node:net");
const tls = require("node:tls");
const fs = require("node:fs");
const path = require("node:path");

const SLICES = ["AAAA", "BBBB", "CCCC", "DDDD", "EEEE"];
const IDLE_TURNS = 5;

const shapes = ["burst", "paced"];
const whens = ["sync", "connect", "firstSlice"];
const rets = ["undef", "falseThenRead", "falseThenResume"];

// later(label, fn) queues fn for the next time the cell is idle. onSlice(n, fn) runs fn inside the nth callback.
const consumers = {
  none() {},
  data({ s, log }) {
    s.on("data", d => log("data:" + d.length));
  },
  readable({ s, log }) {
    s.on("readable", () => {
      const chunk = s.read();
      log("readable:" + (chunk === null ? null : chunk.length));
    });
  },
  forAwait({ s, log }) {
    (async () => {
      for await (const chunk of s) log("chunk:" + chunk.length);
      log("loop-done");
    })().catch(e => log("loop-error:" + e.code));
  },
  readableRemoved({ s, log, onSlice }) {
    const listener = () => log("readable");
    s.on("readable", listener);
    onSlice(3, () => {
      log("removeListener()");
      s.removeListener("readable", listener);
    });
  },
  pauseResume({ s, log, later }) {
    log("pause()");
    s.pause();
    later("resume()", () => s.resume());
  },
  pauseRead({ s, log, later }) {
    log("pause()");
    s.pause();
    later("read()", () => s.read());
  },
  pauseResumeSync({ s, log }) {
    log("pause();resume()");
    s.pause();
    s.resume();
  },
  resumePause({ s, log, later }) {
    log("resume();pause()");
    s.resume();
    s.pause();
    later("resume()", () => s.resume());
  },
  readablePause({ s, log }) {
    s.on("readable", () => log("readable"));
    log("pause()");
    s.pause();
  },
  readablePauseResume({ s, log, later }) {
    s.on("readable", () => log("readable"));
    log("pause()");
    s.pause();
    later("resume()", () => s.resume());
  },
};

const cells = [];
for (const shape of shapes)
  for (const consumer of Object.keys(consumers))
    for (const when of whens) for (const ret of rets) cells.push(["tcp", shape, consumer, when, ret].join("/"));
// The TLS socket shares the code under test. A subset covers what differs: its reads start with the handshake, not with
// read(0). Only "paced": node hands out the rest of a decrypted record even after a `false` return, bun holds it back.
for (const consumer of ["readable", "forAwait", "pauseResume", "pauseRead", "readablePauseResume"])
  for (const when of ["sync", "firstSlice"])
    for (const ret of ["undef", "falseThenResume"]) cells.push(["tls", "paced", consumer, when, ret].join("/"));

const keys = path.join(__dirname, "..", "test", "fixtures", "keys");
let serverOptions;
function tlsServerOptions() {
  return (serverOptions ??= {
    key: fs.readFileSync(path.join(keys, "agent1-key.pem")),
    cert: fs.readFileSync(path.join(keys, "agent1-cert.pem")),
  });
}

function runCell(name) {
  const [transport, shape, consumer, when, ret] = name.split("/");
  const secure = transport === "tls";
  return new Promise((resolve, reject) => {
    const trace = [];
    const deferred = [];
    const sliceHooks = new Map();
    let serverSocket;
    let sent = 0;
    let inflight = 0;
    let calls = 0;
    let connected = false;
    let attached = false;
    let finished = false;

    const log = entry => {
      if (!finished) trace.push(entry);
    };
    const later = (label, fn) =>
      deferred.push(() => {
        log(label);
        fn();
      });
    const onSlice = (n, fn) => sliceHooks.set(n, fn);
    const flushed = () => inflight--;
    const finish = () => {
      finished = true;
      client.destroy();
      if (serverSocket) serverSocket.destroy();
      server.close();
      resolve(trace.join(" "));
    };
    const attach = () => {
      if (attached) return;
      attached = true;
      log("attach");
      consumers[consumer]({ s: client, log, later, onSlice });
    };
    const sendNext = () => {
      if (sent === SLICES.length) return;
      const slice = SLICES[sent++];
      inflight++;
      if (sent === SLICES.length) serverSocket.end(slice, flushed);
      else serverSocket.write(slice, flushed);
    };

    const onConnection = socket => {
      serverSocket = socket;
      socket.on("error", () => {});
      // Nagle would hold a slice until the peer's delayed ACK of the previous one: that is time, not loop turns.
      socket.setNoDelay(true);
      if (shape === "burst") {
        sent = SLICES.length;
        inflight++;
        socket.end(SLICES.join(""), flushed);
      } else {
        sendNext();
      }
    };
    const server = secure ? tls.createServer(tlsServerOptions(), onConnection) : net.createServer(onConnection);
    server.on("error", reject);

    let client;
    server.listen(0, "127.0.0.1", () => {
      client = (secure ? tls : net).connect({
        port: server.address().port,
        host: "127.0.0.1",
        rejectUnauthorized: false,
        onread: {
          buffer: Buffer.alloc(SLICES[0].length),
          callback(nread, buffer) {
            log(buffer.toString("latin1", 0, nread));
            calls++;
            if (shape === "paced") sendNext();
            if (when === "firstSlice" && calls === 1) attach();
            const hook = sliceHooks.get(calls);
            if (hook) hook();
            if (calls === 2 && ret !== "undef") {
              log("return-false");
              if (ret === "falseThenRead") later("read()", () => client.read());
              else later("resume()", () => client.resume());
              return false;
            }
          },
        },
      });
      client.on("error", e => log("error:" + e.code));
      client.on("end", () => log("end"));
      client.on("close", () => {
        log("close");
        finish();
      });
      client.on(secure ? "secureConnect" : "connect", () => {
        connected = true;
        if (when === "connect") attach();
      });
      if (when === "sync") attach();

      // The cell is idle when the server's writes are flushed and the trace stopped moving. An idle cell takes its next
      // deferred step. With none left, nothing can move it again: that is a stall.
      let idle = 0;
      let seen = -1;
      const turn = () => {
        if (finished) return;
        if (connected && serverSocket && inflight === 0) {
          if (trace.length === seen) idle++;
          else {
            idle = 0;
            seen = trace.length;
          }
          if (idle === IDLE_TURNS) {
            idle = 0;
            const step = deferred.shift();
            if (step) {
              step();
            } else {
              log("STALL");
              return finish();
            }
          }
        }
        setImmediate(turn);
      };
      setImmediate(turn);
    });
  });
}

module.exports = { cells, consumerNames: Object.keys(consumers), runCell };

if (require.main === module) {
  (async () => {
    const traces = {};
    for (const name of cells) traces[name] = await runCell(name);
    process.stdout.write(JSON.stringify(traces, null, 2) + "\n");
  })();
}
