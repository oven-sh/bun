// Runs unchanged under node: <runtime> socket-fd-end-fixture.js <group>
//
// Each scenario of the group ends a net.Socket that adopted an fd for writing: one scenario after
// the other, each on its own fd. The report, one JSON line on fd 2, is what every scenario saw.
// The process then lives until fd 0 closes, so that its parent can look at the other end of each
// fd while this process is alive.
//
// fds: 0 a pipe that the parent closes last, 1 a socket, 2 the report, then one fd per scenario in
// the order of the group. The parent decides what that fd is: a socket, unless the scenario says
// something else.
const fs = require("node:fs");
const net = require("node:net");

const report = {};
let onUncaughtException;
process.on("uncaughtException", err => onUncaughtException(err));

// "written" while the write side of the fd is open.
function lateWrite(fd) {
  try {
    fs.writeSync(fd, "late");
    return "written";
  } catch (err) {
    return err.code;
  }
}

function adopt(name, fd, recorded = ["prefinish", "finish", "close"], options = { readable: false }) {
  const socket = new net.Socket({ fd, writable: true, ...options });
  const entry = (report[name] = { fd, events: [] });
  for (const event of recorded) socket.on(event, () => entry.events.push(event));
  socket.on("error", err => entry.events.push("error " + err.code));
  return [socket, entry];
}

const endCallback = entry => err => entry.events.push("end callback" + (err ? " " + err.code : ""));

// The scenario throws, and nothing destroys its socket: the fd stays open.
function afterUncaughtException(entry, fd, done) {
  onUncaughtException = () => {
    entry.events.push("uncaughtException");
    entry.late = lateWrite(fd);
    done();
  };
}

function throwingEndCallback(name, fd, done) {
  const [socket, entry] = adopt(name, fd);
  afterUncaughtException(entry, fd, done);
  socket.end("x", () => {
    throw new Error(name);
  });
}

function endOnly(name, fd, done) {
  const [socket] = adopt(name, fd);
  socket.on("close", done);
  socket.end("x");
}

// libuv completes a cancelled shutdown before 'close', so nothing of end() is pending at 'close'.
function untilClose(socket, entry, done) {
  socket.on("close", () => {
    entry.pendingcb = socket._writableState.pendingcb;
    done();
  });
}

// `then` runs right after end("x"): it calls destroy() from where the name of the scenario says.
const endThen = then => (name, fd, done) => {
  const [socket, entry] = adopt(name, fd);
  untilClose(socket, entry, done);
  socket.end("x", endCallback(entry));
  then(socket, entry);
};

// `from` calls end() from the place that the name of the scenario says. That place queues an
// immediate before end(), and a nextTick and a microtask after it. 'close' is left out: node
// emits it from the loop, and bun on a tick.
const orderFrom = from => (name, fd, done) => {
  const { AsyncLocalStorage } = require("node:async_hooks");
  const [socket, entry] = adopt(name, fd, ["prefinish", "finish"]);
  const store = new AsyncLocalStorage();
  let pending = 2;
  const settle = () => --pending === 0 && done();
  socket.on("close", settle);
  from(() => {
    setImmediate(() => {
      entry.events.push("setImmediate");
      settle();
    });
    store.run("store", () => socket.end("x", () => entry.events.push("end callback in " + store.getStore())));
    entry.events.push("end() returned");
    process.nextTick(() => entry.events.push("nextTick"));
    queueMicrotask(() => entry.events.push("microtask"));
  });
};

// A TCP connection inside this process. `then(client, peer)` runs in a socket callback: the 'data'
// callback of the peer.
function connection(then) {
  const server = net.createServer(peer => {
    peer.once("data", () => then(client, peer));
    peer.on("error", () => {});
    peer.on("close", () => server.close());
  });
  const client = new net.Socket();
  client.on("error", () => {});
  server.listen(0, "127.0.0.1", () => client.connect(server.address().port, "127.0.0.1", () => client.write("a")));
}

// In these, end() and the destroy() are in two phases of one loop turn, or the destroy() is in a
// callback of a socket that has a handle. `then` runs in a socket callback.
const acrossPhases = then => (name, fd, done) => {
  const [socket, entry] = adopt(name, fd);
  connection((client, peer) => {
    untilClose(socket, entry, () => {
      client.destroy();
      peer.destroy();
      done();
    });
    then(socket, endCallback(entry), client, peer);
  });
};

const groups = {
  // end() half-closes the fd: the peer reads end-of-file, and a later write fails with EPIPE.
  end: {
    // Nothing destroys these three sockets, so nothing closes the fd.
    "the end() callback throws": throwingEndCallback,
    "a 'finish' listener throws"(name, fd, done) {
      const [socket, entry] = adopt(name, fd);
      afterUncaughtException(entry, fd, done);
      socket.on("finish", () => {
        throw new Error(name);
      });
      socket.end("x");
    },
    // The shutdown comes before 'prefinish', and node reports the throw inside the async context of end().
    "a 'prefinish' listener throws"(name, fd, done) {
      const { AsyncLocalStorage } = require("node:async_hooks");
      const [socket, entry] = adopt(name, fd);
      const store = new AsyncLocalStorage();
      onUncaughtException = () => {
        entry.events.push("uncaughtException in " + store.getStore());
        done();
      };
      socket.on("prefinish", () => {
        entry.late = lateWrite(fd);
        throw new Error(name);
      });
      // A throw inside end() is an error of the stream, which then closes.
      socket.on("close", done);
      store.run("store", () => socket.end("x"));
    },
    "autoDestroy is off"(name, fd, done) {
      const [socket, entry] = adopt(name, fd);
      socket._writableState.autoDestroy = false;
      socket.on("finish", () => {
        entry.late = lateWrite(fd);
        done();
      });
      socket.end("x", endCallback(entry));
    },
    // The shutdown does not wait for a clock that a program put in place of setImmediate.
    "a fake clock holds the immediates"(name, fd, done) {
      const [socket, entry] = adopt(name, fd);
      const real = globalThis.setImmediate;
      entry.held = 0;
      globalThis.setImmediate = () => void entry.held++;
      socket.end("x");
      real(() =>
        real(() => {
          globalThis.setImmediate = real;
          done();
        }),
      );
    },
    // The close in destroy() gives the peer no end-of-file here.
    "another process holds the socket": endOnly,
    // destroy() does not close fd 0, 1 or 2.
    "the fd is 1"(name, _, done) {
      const [socket, entry] = adopt(name, 1);
      socket.on("close", () => {
        entry.late = lateWrite(1);
        done();
      });
      socket.end("x");
    },
    // shutdown(2) fails on a FIFO: its reader gets end-of-file when the fd closes.
    "the fd is a FIFO": throwingEndCallback,
  },
  // A destroy() that comes before the loop issues the shutdown cancels it. The parent holds each
  // of these sockets too, so it can tell.
  destroy: {
    "destroy() in the block of end()": endThen(socket => socket.destroy()),
    "destroy() on the next tick": endThen(socket => process.nextTick(() => socket.destroy())),
    "destroy() in a microtask": endThen(socket => queueMicrotask(() => socket.destroy())),
    "destroy() after an await": endThen(async socket => {
      await null;
      socket.destroy();
    }),
    // The loop issues the shutdown before it runs this immediate.
    "destroy() in setImmediate": endThen(socket => setImmediate(() => socket.destroy())),
    // The write destroys the socket in the block of end().
    "write() after end()": endThen((socket, entry) =>
      socket.write("y", err => entry.events.push("write callback " + err.code)),
    ),
    "end() two times": endThen(socket => socket.end()),
    // The cancelled shutdown must not end the next life of the socket. That life waits for a
    // lookup that never answers: only a callback that the first life left behind can finish it.
    "'close' connects the socket again"(name, fd, done) {
      const [socket, entry] = adopt(name, fd, ["connect", "prefinish", "finish", "close"]);
      socket.once("close", () => {
        socket.connect({ port: 1, host: "localhost", lookup() {} });
        socket.end();
        setImmediate(() =>
          setImmediate(() => {
            entry.connecting = socket.connecting;
            done();
          }),
        );
      });
      socket.end("x");
      socket.destroy();
    },
    // A shutdown that the loop issued is over: the next life has nothing of it to cancel.
    "connect() after the shutdown"(name, fd, done) {
      const [socket, entry] = adopt(name, fd);
      socket._writableState.autoDestroy = false;
      socket.on("finish", () => {
        socket.connect({ port: 1, host: "localhost", lookup() {} });
        setImmediate(() =>
          setImmediate(() => {
            entry.connecting = socket.connecting;
            done();
          }),
        );
      });
      socket.end("x");
    },
    // destroy() closed the fd: the next life of the socket has nothing to shut down, and ends at once.
    "end() in the next life of the socket"(name, fd, done) {
      const [socket, entry] = adopt(name, fd);
      socket.once("close", () => {
        socket._undestroy();
        untilClose(socket, entry, done);
        socket.end();
      });
      socket.destroy();
    },
    // Each socket has its own request: the 'finish' of the first comes before the shutdown of the second.
    "the 'finish' of another socket destroys it"(name, fd, done) {
      const [socket, entry] = adopt(name, fd);
      const first = new net.Socket({ fd: 1, writable: true, readable: false });
      first.on("finish", () => socket.destroy());
      untilClose(socket, entry, done);
      first.end();
      socket.end("x", endCallback(entry));
    },
  },
  // Where the shutdown comes among what the place that calls end() queued. libuv issues it from
  // its pending queue, and bun from its task queue: after the ticks and the microtasks of that
  // place, ahead of the immediates of the loop turn.
  order: {
    // The first scenario of a group runs from the main script.
    "from the main script": orderFrom(run => run()),
    "from a nextTick": orderFrom(run => process.nextTick(run)),
    "from a microtask": orderFrom(run => queueMicrotask(run)),
    "from a timer": orderFrom(run => setTimeout(run, 1)),
    "from a socket callback": orderFrom(run => {
      const server = net.createServer(peer => peer.destroy());
      server.listen(0, "127.0.0.1", () => {
        const client = net.connect(server.address().port, "127.0.0.1", () => {
          run();
          client.destroy();
          server.close();
        });
      });
    }),
    "from an fs callback": orderFrom(run => fs.stat(__filename, run)),
    "from an immediate": orderFrom(run => setImmediate(run)),
    "from the 'finish' of another socket": orderFrom(run =>
      new net.Socket({ fd: 1, writable: true, readable: false }).on("finish", run).end(),
    ),
    // The loop has issued the shutdown when this immediate runs.
    "an immediate that was queued before end() calls destroy()"(name, fd, done) {
      const [socket, entry] = adopt(name, fd);
      untilClose(socket, entry, done);
      setImmediate(() => socket.destroy());
      socket.end("x", endCallback(entry));
    },
    // And when the loop runs this callback: the mkdir is over before end(), so its callback is
    // queued, or about to be.
    "an fs callback that was complete before end() calls destroy()"(name, fd, done) {
      const [socket, entry] = adopt(name, fd);
      untilClose(socket, entry, done);
      const dir = require("node:path").join(require("node:os").tmpdir(), `socket-fd-end-${process.pid}-${fd}`);
      fs.mkdir(dir, () => {
        fs.rmdirSync(dir);
        socket.destroy();
      });
      while (!fs.existsSync(dir));
      socket.end("x", endCallback(entry));
    },
    // Until the loop issues the shutdown, another holder of the socket can write: in the block of
    // end(), on a tick, after an await.
    "writes through the fd after end()"(name, fd, done) {
      const [socket, entry] = adopt(name, fd);
      socket._writableState.autoDestroy = false;
      const late = (entry.late = {});
      socket.on("finish", () => {
        late.finish = lateWrite(fd);
        done();
      });
      socket.end("x");
      late.block = lateWrite(fd);
      process.nextTick(() => (late.nextTick = lateWrite(fd)));
      (async () => {
        await null;
        late.await = lateWrite(fd);
      })();
    },
  },
  // Where the reports of the two differ. The loop of bun runs its timers and polls its sockets at
  // other points of the turn than libuv does, and a socket that has a handle ends on ticks. So a
  // destroy() from there comes before the shutdown in bun, and after it in node.
  phases: {
    "end() in a socket callback, destroy() in a timer that is due": acrossPhases((socket, callback) => {
      const due = Date.now() + 5;
      setTimeout(() => socket.destroy(), 1);
      while (Date.now() < due);
      socket.end("x", callback);
    }),
    // The byte is on its way to the client before the immediate runs.
    "end() in an immediate, destroy() in a socket callback that is ready": acrossPhases(
      (socket, callback, client, peer) => {
        client.once("data", () => socket.destroy());
        peer.write("z");
        setImmediate(() => socket.end("x", callback));
      },
    ),
    "destroy() in the end() callback of a socket that has a handle": acrossPhases((socket, callback, client) => {
      socket.end("x", callback);
      client.end(() => socket.destroy());
    }),
  },
  // What only bun does: its connect() takes an fd, and gives a socket that adopted an fd a new
  // handle. It ends a socket that has no `readable: false` by itself. It adopts a datagram socket.
  // It has Bun.gc().
  bun: {
    // connect({ fd }) gives the fd to a native handle, which closes it when the peer hangs up, or
    // here. The number is then not end()'s to shut down: _final completes inside end(), as on any
    // socket that has no handle.
    "connect({ fd }) gave the fd to a handle"(name, fd, done) {
      const socket = net.connect({ fd, writable: true, readable: false });
      const entry = (report[name] = { fd, events: [] });
      socket.on("prefinish", () => entry.events.push("prefinish"));
      // destroy() closes the number too.
      socket._writableState.autoDestroy = false;
      socket._handle.close();
      (function untilHandleCloses() {
        if (socket._handle) return setImmediate(untilHandleCloses);
        socket.on("finish", done);
        socket.end();
        entry.events.push("end() returned");
      })();
    },
    // The new handle starts the next life of the socket, which forgets that end() was called: the
    // shutdown is cancelled first, and the life that end() was called in finishes.
    "connect() in the block of end()"(name, fd, done) {
      const [socket, entry] = adopt(name, fd);
      untilClose(socket, entry, done);
      socket.end("x", endCallback(entry));
      socket.connect({ port: 1, host: "localhost", lookup() {} });
      entry.events.push("connect() returned");
    },
    // bun does not read an adopted fd: it gives this socket an EOF, and the stream then ends the
    // socket by itself. That end() is not the caller's, and it leaves the fd as it is.
    "`readable` is omitted"(name, fd, done) {
      const [socket] = adopt(name, fd, ["prefinish", "finish", "close"], {});
      socket.on("close", done);
    },
    // A FIFO has nothing to shut down, and keeps the order it had. In node, 'prefinish' comes
    // after end() returns for a FIFO too.
    "the fd is a FIFO"(name, fd, done) {
      const [socket, entry] = adopt(name, fd);
      socket.on("close", done);
      socket.end("x");
      entry.events.push("end() returned");
    },
    // node refuses this fd. A shutdown(2) stops the sends of every holder of a datagram socket.
    "the fd is a datagram socket"(name, fd, done) {
      const [socket, entry] = adopt(name, fd);
      socket.on("close", done);
      socket.end();
      entry.events.push("end() returned");
    },
    // Until the loop issues the shutdown, its task is all that refers to the socket.
    "nothing else refers to the socket"(name, fd, done) {
      const entry = (report[name] = { fd, events: [] });
      new net.Socket({ fd, writable: true, readable: false })
        .on("finish", () => {
          entry.events.push("finish");
          done();
        })
        .end("x");
      Bun.gc(true);
      queueMicrotask(() => Bun.gc(true));
      process.nextTick(() => Bun.gc(true));
    },
    // The script of a disposed graph gets no callback. Its peer still gets the end-of-file.
    "the Bun.ModuleGraph that called end() is disposed"(name, fd, done) {
      const [socket] = adopt(name, fd);
      const graph = new Bun.ModuleGraph();
      graph.run(() => socket.end("x"));
      graph.dispose();
      setImmediate(() => setImmediate(done));
    },
    // A request holds two handles until its task runs, whether the loop issues the shutdown or a
    // destroy() cancelled it.
    "200 requests leave no handle"(name, _, done) {
      const { heapStats } = require("bun:jsc");
      const entry = (report[name] = { fd: 1, events: [] });
      Bun.gc(true);
      const before = heapStats().protectedObjectCount;
      let open = 200;
      for (let i = 0; i < 200; i++) {
        const socket = new net.Socket({ fd: 1, writable: true, readable: false });
        socket.on("close", () => {
          if (--open > 0) return;
          setImmediate(() => {
            Bun.gc(true);
            entry.handles = heapStats().protectedObjectCount - before;
            done();
          });
        });
        socket.end();
        if (i % 2) socket.destroy();
      }
    },
  },
  // The parent holds this socket too, with a handle of its own.
  tcp: { "the fd is a TCP socket": endOnly },
  // An exit in the block of end() comes before the loop. The exit of a worker still issues the
  // shutdown. The exit of the process does not: the parent then still writes through the socket.
  exit: {
    "a worker exits in the block of end()"(name, fd, done) {
      report[name] = { fd, events: [] };
      const end = `new (require("node:net").Socket)({ fd: ${fd}, writable: true, readable: false }).end("x");`;
      new (require("node:worker_threads").Worker)(end + "process.exit(0);", { eval: true }).on("exit", done);
    },
    "process.exit() in the block of end()"(name, fd) {
      adopt(name, fd)[0].end("x");
      fs.writeSync(2, JSON.stringify(report) + "\n");
      process.exit(0);
    },
  },
  // connect({ fd }) gives the fd that end() shut down to a native handle.
  handle: {
    "connect({ fd }) after the shutdown"(name, fd, done) {
      const [socket] = adopt(name, fd);
      socket._writableState.autoDestroy = false;
      socket.on("finish", () => {
        socket.connect({ fd });
        setImmediate(done);
      });
      socket.end("x");
    },
  },
};

const scenarios = Object.entries(groups[process.argv[2]]);
// Each scenario starts from its own setImmediate: nothing of the one before it is still queued.
(function next(i) {
  if (i < scenarios.length) {
    let over = false;
    return scenarios[i][1](scenarios[i][0], 3 + i, () => over || ((over = true), setImmediate(next, i + 1)));
  }
  fs.writeSync(2, JSON.stringify(report) + "\n");
  fs.read(0, Buffer.alloc(1), 0, 1, null, () => process.exit(0));
})(0);
