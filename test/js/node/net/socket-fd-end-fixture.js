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

// Nothing of end() is pending at 'close', whether the shutdown was issued or cancelled.
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

// end() and the destroy() are in two phases of one loop turn, or the destroy() is in a callback of
// a socket that has a handle. `then` runs in a socket callback.
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
    // The shutdown comes before 'prefinish', and the throw is reported inside the async context of end().
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
    // The close in destroy() gives the peer no end-of-file here.
    "another process holds the socket": endOnly,
    // A number that the engine holds as a double is the same fd.
    "the fd is held as a double": (name, fd, done) => endOnly(name, new Float64Array([fd])[0], done),
    // shutdown(2) fails on a FIFO: its reader gets end-of-file when the fd closes.
    "the fd is a FIFO": throwingEndCallback,
  },
  // A destroy() in the block of end() comes before the shutdown, and cancels it. The parent holds
  // these sockets too, so it can tell.
  destroy: {
    "destroy() in the block of end()": endThen(socket => socket.destroy()),
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
    // A shutdown that was issued is over: the next life has nothing of it to cancel.
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
    // destroy() closed the fd: the next life of the socket has nothing to shut down, and still ends.
    "end() in the next life of the socket"(name, fd, done) {
      const [socket, entry] = adopt(name, fd);
      socket.once("close", () => {
        socket._undestroy();
        untilClose(socket, entry, done);
        socket.end();
      });
      socket.destroy();
    },
  },
  // What the loop runs after the block of end() finds the socket finished and the fd half-closed,
  // whatever its phase. The parent holds these sockets too.
  loop: {
    "destroy() in setImmediate": endThen(socket => setImmediate(() => socket.destroy())),
    "an immediate that was queued before end() calls destroy()"(name, fd, done) {
      const [socket, entry] = adopt(name, fd);
      untilClose(socket, entry, done);
      setImmediate(() => socket.destroy());
      socket.end("x", endCallback(entry));
    },
    "end() in a socket callback, destroy() in a timer that is due": acrossPhases((socket, callback) => {
      setTimeout(() => socket.destroy(), 1);
      const due = performance.now() + 5;
      while (performance.now() < due);
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
    // The file closes from the loop, after the tick on which pipe() ended the socket.
    "pipe() from a file ends it, finished() of the file destroys it"(name, fd, done) {
      const [socket, entry] = adopt(name, fd);
      untilClose(socket, entry, done);
      const file = fs.createReadStream(__filename, { end: 0 });
      require("node:stream").finished(file, () => socket.destroy());
      file.pipe(socket);
    },
    "pipeline() from a file ends it"(name, fd, done) {
      const [socket, entry] = adopt(name, fd);
      let pending = 2;
      const settle = () => --pending === 0 && done();
      untilClose(socket, entry, settle);
      require("node:stream").pipeline(fs.createReadStream(__filename, { end: 0 }), socket, err => {
        entry.pipeline = err ? err.code : "over";
        settle();
      });
    },
    "destroySoon()"(name, fd, done) {
      const [socket, entry] = adopt(name, fd);
      untilClose(socket, entry, done);
      socket.write("x");
      socket.destroySoon();
    },
  },
  // libuv issues the shutdown from the loop, after every tick of the place that called end(). bun
  // issues it on the first of those ticks, as for a socket that has a handle. So bun has finished,
  // and has half-closed the fd, where node still cancels, and where node still lets a write through.
  later: {
    "destroy() on the next tick": endThen(socket => process.nextTick(() => socket.destroy())),
    "destroy() in a microtask": endThen(socket => queueMicrotask(() => socket.destroy())),
    "destroy() after an await": endThen(async socket => {
      await null;
      socket.destroy();
    }),
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
  // The parent holds this socket too, with a handle of its own.
  tcp: { "the fd is a TCP socket": endOnly },
  // process.exit() comes before the shutdown: none is issued, and the parent still writes through
  // the socket after this process is gone.
  exit: {
    "process.exit() in the block of end()"(name, fd) {
      adopt(name, fd)[0].end("x");
      fs.writeSync(2, JSON.stringify(report) + "\n");
      process.exit(0);
    },
  },
  // What bun adopts and does not shut down. Each of these is as it was before end() issued any
  // shutdown: 'prefinish' comes inside end().
  unarmed: {
    // connect({ fd }) gives the fd to a native handle, which closes it when the peer hangs up, or
    // here. The number is then not end()'s to shut down.
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
    // bun does not read an adopted fd: it gives this socket an EOF, and the stream then ends the
    // socket by itself. That end() is not the caller's.
    "`readable` is omitted"(name, fd, done) {
      const [socket] = adopt(name, fd, ["prefinish", "finish", "close"], {});
      socket.on("close", done);
    },
    // process.stdout writes to fd 1 too.
    "the fd is 1"(name, _, done) {
      const [socket, entry] = adopt(name, 1);
      socket.on("close", () => {
        entry.late = lateWrite(1);
        done();
      });
      socket.end("x");
      entry.events.push("end() returned");
    },
    // A FIFO has nothing to shut down.
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
