// Prints one row for each way node:dgram completes a bind: the order of what ran.
// Node.js prints the same rows: node --expose-internals --no-warnings <this file> [--udp6 | --workers]
const cluster = require("node:cluster");
const dgram = require("node:dgram");
const dns = require("node:dns");

const isPosix = process.platform !== "win32";

// The row that runs, for the watchdog.
let running = { name: "", order: [] };

// A datagram descriptor that is bound and that no socket reads yet.
function boundDescriptor() {
  const { UDP } = process.versions.bun
    ? require("bun:internal-for-testing").exposedInternals["internal/dgram"]
    : require("internal/test/binding").internalBinding("udp_wrap");
  const wrap = new UDP();
  if (wrap.bind("127.0.0.1", 0, 0) !== 0) throw new Error("could not bind a descriptor");
  return wrap;
}

// "number" once the socket is bound.
function portOf(socket) {
  try {
    return typeof socket.address().port;
  } catch {
    return "none";
  }
}

function row(name, start) {
  return new Promise((resolve, reject) => {
    // Not inside a promise job: bind({ fd }) calls back before it returns.
    setImmediate(() => {
      const order = [];
      const cleanup = [];
      running = { name, order };
      const finish = () => {
        for (const close of cleanup) close();
        resolve(`${name}: ${order.join(" ")}`);
      };
      // The callback under test. The row ends when the tick and the microtask that it queues have run.
      const step = () => {
        order.push("callback");
        let left = 2;
        const ran = what => () => {
          order.push(what);
          if (--left === 0) finish();
        };
        process.nextTick(ran("nextTick"));
        queueMicrotask(ran("microtask"));
      };
      const socket = options => {
        const created = dgram.createSocket(options || "udp4");
        created.on("error", reject);
        cleanup.push(() => created.close());
        return created;
      };
      const descriptor = () => {
        const wrap = boundDescriptor();
        cleanup.push(() => wrap.close());
        return wrap.fd;
      };
      try {
        start({ step, socket, descriptor, order, finish, cleanup });
      } catch (error) {
        reject(error);
      }
    });
  });
}

const lookupInsideBind = (host, family, callback) => callback(null, "127.0.0.1", 4);
const lookupLater = (host, family, callback) => setImmediate(callback, null, "127.0.0.1", 4);
const lookupTwice = (host, family, callback) => {
  callback(null, "127.0.0.1", 4);
  callback(null, "127.0.0.1", 4);
};

// Runs `start` while dns.lookup is a function that answers at once, as the stub of a test suite does.
const underStubbedDnsLookup = start => context => {
  const { lookup } = dns;
  dns.lookup = lookupInsideBind;
  context.cleanup.push(() => (dns.lookup = lookup));
  start(context);
};

// A socket whose `lookup` option calls back twice. libuv refuses the second bind of a handle, except on Windows.
const boundTwice = ({ order, cleanup }) => {
  const twice = dgram.createSocket({ type: "udp4", lookup: lookupTwice });
  cleanup.push(() => twice.removeAllListeners("close"));
  twice.on("listening", () => order.push("listening"));
  twice.on("error", error => order.push(`error:"${error.message}"`));
  twice.on("close", () => order.push("close"));
  twice.bind(0, "name.invalid");
  return twice;
};

// Calls `start` with the port of a socket that receives.
const withReceiver = start => context => {
  const receiver = context.socket();
  receiver.bind(0, "127.0.0.1", () => start(context, receiver.address().port));
};

const rows = [
  // A callback that runs outside a promise job: its tick runs before its microtask.
  ["'listening' of bind()", ({ step, socket }) => socket().on("listening", step).bind()],
  ["'listening' of bind(0)", ({ step, socket }) => socket().on("listening", step).bind(0)],
  ["'listening' of bind(0, address)", ({ step, socket }) => socket().on("listening", step).bind(0, "127.0.0.1")],
  [
    "'listening' of bind({ port, address })",
    ({ step, socket }) => socket().on("listening", step).bind({ port: 0, address: "127.0.0.1" }),
  ],
  ["bind(callback)", ({ step, socket }) => socket().bind(step)],
  ["bind(0, callback)", ({ step, socket }) => socket().bind(0, step)],
  ["bind(0, address, callback)", ({ step, socket }) => socket().bind(0, "127.0.0.1", step)],
  ["bind({ port }, callback)", ({ step, socket }) => socket().bind({ port: 0 }, step)],
  [
    "'listening' with a lookup option that calls back inside bind()",
    ({ step, socket }) =>
      socket({ type: "udp4", lookup: lookupInsideBind }).on("listening", step).bind(0, "name.invalid"),
  ],
  [
    "'listening' with a lookup option that calls back later",
    ({ step, socket }) => socket({ type: "udp4", lookup: lookupLater }).on("listening", step).bind(0, "name.invalid"),
  ],
  [
    "'listening' of the bind that send() starts",
    withReceiver(({ step, socket }, port) => socket().on("listening", step).send("x", port, "127.0.0.1")),
  ],
  [
    "'listening' of the bind that connect() starts",
    withReceiver(({ step, socket }, port) => socket().on("listening", step).connect(port, "127.0.0.1")),
  ],

  // 'listening' against what else the turn has queued.
  [
    "two sockets bound in one turn",
    ({ socket, order, finish }) => {
      for (const name of ["a", "b"]) {
        socket()
          .on("listening", () => {
            order.push(`callback-${name}`);
            process.nextTick(() => order.push(`nextTick-${name}`));
            queueMicrotask(() => order.push(`microtask-${name}`));
          })
          .bind(0);
      }
      setImmediate(finish);
    },
  ],
  [
    "bind(0), then a nextTick and a microtask",
    ({ socket, order, finish }) => {
      socket()
        .on("listening", () => order.push("listening"))
        .bind(0);
      process.nextTick(() => order.push("nextTick"));
      queueMicrotask(() => order.push("microtask"));
      setImmediate(finish);
    },
  ],
  [
    "bind(0, callback), then close() in a microtask",
    ({ order, finish, cleanup }) => {
      const closed = dgram.createSocket("udp4");
      closed.on("listening", () => order.push("listening"));
      closed.on("close", () => {
        order.push("close");
        finish();
      });
      closed.bind(0, () => order.push("callback"));
      queueMicrotask(() => closed.close());
      // Ends the row where the bind never completes.
      cleanup.push(() => closed.removeAllListeners("close"));
    },
  ],

  // 'listening' fires in the tick after bind(0). A listener that a microtask attaches is in time
  // only where the microtasks run first: inside a promise job.
  [
    "bind(0), then a listener from a microtask",
    ({ socket, order, finish }) => {
      const late = socket();
      late.bind(0);
      queueMicrotask(() => late.on("listening", () => order.push("listening")));
      setImmediate(() => {
        if (order.length === 0) order.push("missed");
        finish();
      });
    },
  ],
  [
    "bind(0), then a listener from a microtask, inside a promise job",
    ({ socket, order, finish }) => {
      Promise.resolve().then(() => {
        const late = socket();
        late.bind(0);
        queueMicrotask(() => late.on("listening", () => order.push("listening")));
        setImmediate(() => {
          if (order.length === 0) order.push("missed");
          finish();
        });
      });
    },
  ],

  // A lookup option that calls back inside bind(): the bind is complete when bind() returns.
  [
    "bind(0, name, callback) with a lookup option that calls back inside, and the line after it",
    ({ socket, order, finish }) => {
      const bound = socket({ type: "udp4", lookup: lookupInsideBind }).on("listening", () => order.push("listening"));
      bound.bind(0, "name.invalid", () => order.push("callback"));
      order.push("returned", `port:${portOf(bound)}`);
      setImmediate(finish);
    },
  ],
  [
    "send() that binds with a lookup option that calls back inside, and the line after it",
    withReceiver(({ socket, order, finish }, port) => {
      const sender = socket({ type: "udp4", lookup: lookupInsideBind }).on("listening", () => order.push("listening"));
      sender.send("x", port, "name.invalid", () => {
        order.push("send-callback");
        finish();
      });
      order.push("returned", `port:${portOf(sender)}`);
    }),
  ],
  [
    "a 'listening' listener that throws, with a lookup option that calls back inside",
    ({ socket, order, finish }) => {
      const bound = socket({ type: "udp4", lookup: lookupInsideBind }).on("listening", () => {
        throw new Error("thrown by the listener");
      });
      try {
        bound.bind(0, "name.invalid");
        order.push("returned");
      } catch (error) {
        order.push(`bind() threw "${error.message}"`);
      }
      order.push(`port:${portOf(bound)}`);
      setImmediate(finish);
    },
  ],
  [
    "a receive buffer size that is refused, with a lookup option that calls back inside",
    ({ order, finish, cleanup }) => {
      const refused = dgram.createSocket({ type: "udp4", lookup: lookupInsideBind, recvBufferSize: 2 ** 31 });
      cleanup.push(() => refused.close());
      refused.on("error", error => order.push(`'error' ${error.code}`));
      refused.on("listening", () => order.push("listening"));
      try {
        refused.bind(0, "name.invalid");
        order.push("returned");
      } catch (error) {
        order.push(`bind() threw ${error.code}`);
      }
      order.push(`port:${portOf(refused)}`);
      setImmediate(finish);
    },
  ],

  // The default lookup answers an IP address from the next tick and never asks dns.lookup for it.
  [
    "bind(0) under a dns.lookup that answers at once, and the line after it",
    underStubbedDnsLookup(({ socket, order, finish }) => {
      const bound = socket().on("listening", () => order.push("listening"));
      bound.bind(0);
      order.push("returned", `port:${portOf(bound)}`);
      setImmediate(finish);
    }),
  ],
  [
    "bind(0, name) under a dns.lookup that answers at once, and the line after it",
    underStubbedDnsLookup(({ socket, order, finish }) => {
      const bound = socket().on("listening", () => order.push("listening"));
      bound.bind(0, "name.invalid");
      order.push("returned", `port:${portOf(bound)}`);
      setImmediate(finish);
    }),
  ],

  // A handle has one socket.
  [
    "a lookup option that calls back twice",
    context => {
      const twice = boundTwice(context);
      setImmediate(() => {
        context.order.push(`port:${portOf(twice)}`);
        twice.close();
        context.finish();
      });
    },
  ],
  [
    "a lookup option that calls back twice, then close()",
    context => {
      boundTwice(context).close();
      setImmediate(context.finish);
    },
  ],

  // What does not wait for the bind keeps the order that it has.
  [
    "'error' of a bind to an address that is not local",
    ({ step, cleanup }) => {
      const failed = dgram.createSocket("udp4").on("error", step);
      cleanup.push(() => failed.close());
      failed.bind(0, "192.0.2.1");
    },
  ],
  [
    "'connect' of connect()",
    withReceiver(({ step, socket }, port) => socket().on("connect", step).connect(port, "127.0.0.1")),
  ],
  ["connect(callback)", withReceiver(({ step, socket }, port) => socket().connect(port, "127.0.0.1", step))],
  ["send(callback)", withReceiver(({ step, socket }, port) => socket().send("x", port, "127.0.0.1", step))],
];

const rowsOfUdp6 = [
  ["'listening' of a udp6 bind(0)", ({ step, socket }) => socket("udp6").on("listening", step).bind(0)],
  ["a udp6 bind(0, address, callback)", ({ step, socket }) => socket("udp6").bind(0, "::1", step)],
];

// What a cluster worker reports of its own bind(0): the primary shares the descriptor.
const inWorker =
  what =>
  ({ order, finish }) => {
    const worker = cluster.fork({ DGRAM_BIND_ORDER_WORKER: what });
    worker.on("message", line => order.push(line));
    worker.on("exit", code => {
      if (code !== 0) order.push(`the worker exited with code ${code}`);
      finish();
    });
  };
const workers = {
  async order() {
    const line = await row("", ({ step, socket }) => socket().on("listening", step).bind(0));
    return line.slice(": ".length);
  },
  throws() {
    return new Promise(resolve => {
      const bound = dgram.createSocket("udp4");
      for (const event of ["uncaughtException", "unhandledRejection"]) {
        process.on(event, error => {
          resolve(`${event} "${error.message}" port:${portOf(bound)}`);
          bound.close();
        });
      }
      bound.on("listening", () => {
        throw new Error("thrown by the listener");
      });
      bound.bind(0);
    });
  },
};

// A descriptor is adopted inside bind(). Windows has no raw descriptors for datagram sockets.
const rowsOfDescriptors = [
  [
    "'listening' of bind({ fd })",
    ({ step, socket, descriptor }) => socket().on("listening", step).bind({ fd: descriptor() }),
  ],
  ["bind({ fd }, callback)", ({ step, socket, descriptor }) => socket().bind({ fd: descriptor() }, step)],
  [
    "bind({ fd }, callback) and the line after it",
    ({ socket, descriptor, order, finish }) => {
      const bound = socket().on("listening", () => order.push("listening"));
      bound.bind({ fd: descriptor() }, () => order.push("callback"));
      order.push("returned", `port:${portOf(bound)}`);
      setImmediate(finish);
    },
  ],
  [
    "a lookup option that calls back twice, then bind({ fd })",
    context => {
      const twice = boundTwice(context);
      try {
        twice.bind({ fd: context.descriptor() });
        context.order.push("bind({ fd }) returned");
      } catch (error) {
        context.order.push(`bind({ fd }) threw "${error.message}"`);
      }
      setImmediate(() => {
        twice.close();
        context.finish();
      });
    },
  ],
];

// A cluster worker binds the descriptor that the primary shares. Windows has no shared datagram descriptors.
const rowsOfWorkers = [
  ["'listening' of bind(0) in a cluster worker", inWorker("order")],
  ["a 'listening' listener that throws in a cluster worker", inWorker("throws")],
];

async function main() {
  if (cluster.isWorker) {
    process.send(await workers[process.env.DGRAM_BIND_ORDER_WORKER](), () => process.disconnect());
    return;
  }
  // Fail with the row that hangs instead of the deadline of the test.
  setTimeout(() => {
    for (const worker of Object.values(cluster.workers)) worker.process.kill("SIGKILL");
    console.error(`timed out in "${running.name}" after: ${running.order.join(" ")}`);
    process.exit(1);
  }, 20_000).unref();
  if (process.argv.includes("--workers")) {
    // Both workers run at once: a worker takes most of the time of its row.
    for (const line of await Promise.all(rowsOfWorkers.map(([name, start]) => row(name, start)))) console.log(line);
    return;
  }
  const all = [...rows, ...(process.argv.includes("--udp6") ? rowsOfUdp6 : []), ...(isPosix ? rowsOfDescriptors : [])];
  for (const [name, start] of all) console.log(await row(name, start));
}

// The tick queue exists before the first row. Bun drains the queue once right after the first
// promise job that ends after the first read of process.nextTick, and a row is not to be that job.
process.nextTick(() =>
  main().catch(error => {
    console.error(error);
    process.exit(1);
  }),
);
