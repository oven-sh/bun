process.exitCode = 1;
const { AsyncLocalStorage } = require("async_hooks");
const { fork } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const asyncLocalStorage = new AsyncLocalStorage();
const store = () => asyncLocalStorage.getStore()?.test ?? "(no store)";
// Calls a function in no async context at all, wherever the caller runs.
const outsideAnyContext = AsyncLocalStorage.snapshot();

// More than the channel's buffer holds: send() returns before the write is complete, unless the
// peer reads the rest in the meantime.
const big = Buffer.alloc(1 << 20, "x").toString();

// A send() callback that records a failure when it does not run in the store `expected`.
const callbackIn = (expected, failures, then) => error => {
  if (error) failures.push(`FAIL: send() in "${expected}" failed: ${error}`);
  if (store() !== expected) failures.push(`FAIL: send() callback ran in "${store()}", expected "${expected}"`);
  then();
};

// Sends one message the channel takes at once, one that waits for the channel and five that wait
// behind it. Calls done() with the callbacks that did not run in the store of their own send().
function sendRows(target, name, done) {
  const failures = [];
  let pending = 0;
  const callback = expected => {
    pending++;
    return callbackIn(expected, failures, () => --pending === 0 && done(failures));
  };
  const run = (row, message) =>
    asyncLocalStorage.run({ test: `${name} ${row}` }, () => target.send(message, callback(`${name} ${row}`)));
  run("small", { small: true });
  run("big", { big });
  run("queued", { queued: true });
  run("queued again", { queued: true });
  target.send({ queued: true }, callback("(no store)"));
  asyncLocalStorage.run({ test: `${name} replaced` }, () => {
    asyncLocalStorage.enterWith({ test: `${name} entered` });
    target.send({ queued: true }, callback(`${name} entered`));
    asyncLocalStorage.enterWith({ test: `${name} entered again` });
    target.send({ queued: true }, callback(`${name} entered again`));
  });
}

// Sends three messages whose callbacks throw. Calls done() with the errors that 'uncaughtException'
// did not report in the store of their own send().
function sendThrowing(target, name, done) {
  const failures = [];
  const expected = new Map();
  const onUncaughtException = error => {
    if (!expected.has(error)) throw error;
    if (store() !== expected.get(error)) {
      failures.push(`FAIL: 'uncaughtException' ran in "${store()}", expected "${expected.get(error)}"`);
    }
    expected.delete(error);
    if (expected.size > 0) return;
    process.off("uncaughtException", onUncaughtException);
    done(failures);
  };
  process.on("uncaughtException", onUncaughtException);
  const send = (message, test) => {
    const error = new Error("thrown by a send() callback");
    expected.set(error, test ?? "(no store)");
    const call = () =>
      target.send(message, () => {
        throw error;
      });
    test ? asyncLocalStorage.run({ test }, call) : call();
  };
  send({ big }, `${name} big, throws`);
  send({ queued: true }, `${name} queued, throws`);
  send({ queued: true });
}

// Sends the rows of sendRows(), then those of sendThrowing().
function sendAll(target, name, done) {
  sendRows(target, name, failures =>
    outsideAnyContext(sendThrowing, target, name, thrown => done([...failures, ...thrown])),
  );
}

// Waits without a turn of the event loop.
function waitFor(file) {
  const deadline = Date.now() + 30_000;
  const pause = new Int32Array(new SharedArrayBuffer(4));
  while (!fs.existsSync(file)) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${file}`);
    Atomics.wait(pause, 0, 0, 1);
  }
}

// Tells the child to stop reading the channel. Then sends one message per turn of the event loop
// until one waits for the channel, and one more behind it. Then the child reads what the channel
// holds while this process waits without a turn of its event loop, so nothing but the next send()
// can complete the two that wait. That send() is made in another store and has no callback, so
// the last callbacks it queues are those of the two. It must return in its own store.
function sendBehindFullChannel(child, dir, done) {
  const failures = [];
  const hold = { gate: path.join(dir, "gate"), drained: path.join(dir, "drained") };
  const pad = Buffer.alloc(1024, "y").toString();
  let sent = 0;
  let completed = 0;
  let last = false;
  const send = expected => {
    sent++;
    child.send(
      { pad },
      callbackIn(expected, failures, () => ++completed === sent && last && done(failures)),
    );
  };
  const fill = () => {
    if (completed === sent) {
      send("(no store)");
      return setImmediate(fill);
    }
    asyncLocalStorage.run({ test: "waiting" }, send, "waiting");
    // The number of messages the channel took.
    fs.writeFileSync(`${hold.gate}.tmp`, String(completed));
    fs.renameSync(`${hold.gate}.tmp`, hold.gate);
    waitFor(hold.drained);
    last = true;
    asyncLocalStorage.run({ test: "later" }, () => {
      child.send({ pad });
      if (store() !== "later") failures.push(`FAIL: send() returned in "${store()}", expected "later"`);
      send("later");
    });
  };
  child.send({ hold }, callbackIn("(no store)", failures, fill));
}

if (process.argv[2] === "child") {
  process.exitCode = 0;
  // The first use of the channel in this process is a send().
  sendAll(process, "process.send", failures => process.send({ failures }));
  let hold;
  let taken;
  let received = 0;
  process.on("message", message => {
    if (message.hold) {
      // Reads no more of the channel until the parent has filled it.
      hold = message.hold;
      waitFor(hold.gate);
      taken = Number(fs.readFileSync(hold.gate, "utf8"));
    } else if (message.pad) {
      received++;
    }
    if (received === taken) fs.writeFileSync(hold.drained, "");
  });
} else {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "async-context-child_process-send-"));
  const failures = [];
  const child = fork(__filename, ["child"]);
  child.on("exit", code => {
    if (code !== 0) failures.push(`FAIL: child exited with code ${code}`);
    fs.rmSync(dir, { recursive: true, force: true });
    for (const failure of failures) console.error(failure);
    process.exit(failures.length ? 1 : 0);
  });

  let reports = 0;
  const report = reported => {
    failures.push(...reported);
    if (++reports < 2) return;
    // On Windows a write is never complete when send() returns, so no send() completes an earlier one.
    if (process.platform === "win32") return child.disconnect();
    outsideAnyContext(sendBehindFullChannel, child, dir, reported => {
      failures.push(...reported.map(failure => `${failure} (behind a full channel)`));
      child.disconnect();
    });
  };
  child.on("message", message => message.failures && report(message.failures));
  sendAll(child, "child.send", report);
}
