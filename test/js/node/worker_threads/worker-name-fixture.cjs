// Runs one check under Bun or under Node.js, and prints what it observes as JSON.
// worker_threads.test.ts runs each check under both, and expects the values of Node.js v26.3.0.
const { Worker, threadName: mainThreadName } = require("node:worker_threads");

// Runs `source` in a Worker until the worker exits.
function runWorker(source, options = {}) {
  const { promise, resolve, reject } = Promise.withResolvers();
  const worker = new Worker(source, { eval: true, ...options });
  const { threadId, threadName } = worker;
  const messages = [];
  worker.on("message", message => messages.push(message));
  worker.on("error", reject);
  worker.on("exit", exitCode => {
    resolve({ threadId, threadName, threadNameAfterExit: worker.threadName, messages, exitCode });
  });
  return promise;
}

const checks = {
  async names() {
    const source = `
      const { parentPort, threadName } = require("node:worker_threads");
      parentPort.postMessage(threadName);
    `;
    const rows = {
      absent: {},
      undefinedName: { name: undefined },
      empty: { name: "" },
      nullName: { name: null },
      zero: { name: 0 },
      falseName: { name: false },
      nanName: { name: NaN },
      whitespace: { name: " \t " },
      padded: { name: "  padded  " },
    };
    const observed = await Promise.all(
      Object.entries(rows).map(async ([label, options]) => {
        const { threadName, threadNameAfterExit, messages, exitCode } = await runWorker(source, options);
        return [label, { fromParent: threadName, fromWorker: messages, afterExit: threadNameAfterExit, exitCode }];
      }),
    );
    return { mainThread: mainThreadName, ...Object.fromEntries(observed) };
  },

  async osThread() {
    const source = `
      const osThreadName = require("node:fs").readFileSync("/proc/thread-self/comm", "utf8").trim();
      require("node:worker_threads").parentPort.postMessage(osThreadName);
    `;
    const [unnamed, named, blank] = await Promise.all([
      runWorker(source),
      runWorker(source, { name: "named" }),
      runWorker(source, { name: "   " }),
    ]);
    return { unnamed: unnamed.messages, named: named.messages, blank: blank.messages };
  },

  // The trace file has the titles. The test needs the thread ids to find them.
  async trace() {
    const unnamed = new Worker("1", { eval: true });
    const blank = new Worker("1", { eval: true, name: "   " });
    const named = new Worker("1", { eval: true, name: "named" });
    return { unnamed: unnamed.threadId, blank: blank.threadId, named: named.threadId };
  },

  async inspector() {
    const source = `
      const { Session } = require("node:inspector");
      const { parentPort } = require("node:worker_threads");
      // Keeps the worker alive until the inspector reports it.
      parentPort.once("message", () => {});
      const session = new Session();
      session.connectToMainThread();
      session.on("NodeWorker.attachedToWorker", ({ params }) => {
        parentPort.postMessage(params.workerInfo.title);
        process.exit();
      });
      session.post("NodeWorker.enable", { waitForDebuggerOnStart: false });
    `;
    // One worker at a time: in Node.js, the session reports every live worker of the main thread.
    const titles = {};
    for (const [label, options] of Object.entries({ unnamed: {}, blank: { name: "   " }, named: { name: "named" } })) {
      const { threadId, messages } = await runWorker(source, options);
      titles[label] = messages.map(title => title.replace(`[worker ${threadId}]`, "[worker N]"));
    }
    return titles;
  },
};

checks[process.argv[2]]().then(observed => console.log(JSON.stringify(observed)));
