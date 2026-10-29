// Prints how the stat family treats `options.signal`, one line per call.
// fs.test.ts runs this file under Bun, and under Node.js >= 26.8.0 when there is one, against one expected text.
// Nothing here waits for time: the lines are printed once the event loop is empty, so a callback that arrives late
// or twice still lands in its line.
"use strict";
const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { AsyncLocalStorage } = require("node:async_hooks");
const { getEventListeners } = require("node:events");
const { promisify } = require("node:util");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fs-stat-signal-"));
const file = path.join(dir, "file");
const missing = path.join(dir, "missing");
fs.writeFileSync(file, "x");
const fd = fs.openSync(file, "r");

/** `[label, events]`. A line is the label and the events joined. */
const lines = [];
function line(label) {
  const events = [];
  lines.push([label, events]);
  return events;
}

// Which argument an error is about. The message texts of Bun and Node.js differ, the argument does not.
function describe(error) {
  if (error == null) return "stats";
  if (error.code === "ABORT_ERR") return "ABORT_ERR";
  const message = String(error.message);
  const argument = /signal/.test(message)
    ? "signal"
    : /\bcb\b|callback/i.test(message)
      ? "cb"
      : /path/.test(message)
        ? "path"
        : /\bfd\b/.test(message)
          ? "fd"
          : "?";
  return error.code === "ERR_INVALID_ARG_TYPE" || error.code === "ERR_OUT_OF_RANGE"
    ? `${error.code}(${argument})`
    : String(error.code || error.name);
}

// A call of a callback form. `start(callback)` makes the call and can return a function that runs inside the "abort" phase.
function callbackLine(label, start) {
  const events = line(label);
  let phase = "sync";
  const callback = (error, stats) => {
    events.push(`${describe(error)}${error == null && stats === undefined ? "(undefined)" : ""} @${phase}`);
  };
  let abort;
  try {
    abort = start(callback);
  } catch (error) {
    events.push(`throws ${describe(error)}`);
  }
  if (abort) {
    phase = "abort()";
    abort();
  }
  phase = "later";
}

// A call of a promise form. It must never throw synchronously.
async function promiseLine(label, start) {
  const events = line(label);
  let promise;
  try {
    promise = start();
  } catch (error) {
    events.push(`throws ${describe(error)}`);
    return;
  }
  try {
    const value = await promise;
    events.push(value === undefined ? "resolves(undefined)" : "resolves");
  } catch (error) {
    events.push(`rejects ${describe(error)}`);
  }
}

function syncLine(label, call) {
  const events = line(label);
  try {
    call();
    events.push("returns");
  } catch (error) {
    events.push(`throws ${describe(error)}`);
  }
}

const aborted = () => AbortSignal.abort();
const invalid = [
  ["'x'", "x"],
  ["null", null],
  ["1", 1],
  ["{}", {}],
];

async function main() {
  const handle = await fsp.open(file, "r");

  const callbackForms = [
    ["fs.stat(path, ", (options, callback) => fs.stat(file, options, callback)],
    ["fs.lstat(path, ", (options, callback) => fs.lstat(file, options, callback)],
    ["fs.fstat(fd, ", (options, callback) => fs.fstat(fd, options, callback)],
  ];
  for (const [name, call] of callbackForms) {
    callbackLine(`${name}{ signal: aborted }, cb)`, callback => call({ signal: aborted() }, callback));
    callbackLine(`${name}{ signal }, cb) then abort()`, callback => {
      const controller = new AbortController();
      call({ signal: controller.signal }, callback);
      return () => controller.abort();
    });
    callbackLine(`${name}{ signal }, cb), not aborted`, callback =>
      call({ signal: new AbortController().signal }, callback),
    );
    callbackLine(`${name}{ signal: undefined }, cb)`, callback => call({ signal: undefined }, callback));
    callbackLine(`${name}{ signal: aborted, bigint: true }, cb)`, callback =>
      call({ signal: aborted(), bigint: true }, callback),
    );
    for (const [label, value] of invalid) {
      callbackLine(`${name}{ signal: ${label} }, cb)`, callback => call({ signal: value }, callback));
    }
    // `validateAbortSignal` takes any object that has an `aborted` key.
    callbackLine(`${name}{ signal: { aborted: true } }, cb)`, callback =>
      call({ signal: { aborted: true } }, callback),
    );
    callbackLine(`${name}{ signal: { aborted: false } }, cb)`, callback =>
      call({ signal: { aborted: false } }, callback),
    );
    // The options are only read when they are an object.
    callbackLine(`${name}'utf8', cb)`, callback => call("utf8", callback));
    callbackLine(`${name}null, cb)`, callback => call(null, callback));
  }

  // The callback is checked whether there is a signal or not.
  callbackLine("fs.stat(path) without cb", () => fs.stat(file));
  callbackLine("fs.lstat(path, {}) without cb", () => fs.lstat(file, {}));
  callbackLine("fs.fstat(fd) without cb", () => fs.fstat(fd));
  callbackLine("fs.fstat(fd, {}) without cb", () => fs.fstat(fd, {}));

  const promiseForms = [
    ["fsPromises.stat(path, ", options => fsp.stat(file, options)],
    ["fsPromises.lstat(path, ", options => fsp.lstat(file, options)],
    ["filehandle.stat(", options => handle.stat(options)],
  ];
  for (const [name, call] of promiseForms) {
    await promiseLine(`${name}{ signal: aborted })`, () => call({ signal: aborted() }));
    await promiseLine(`${name}{ signal }) then abort()`, () => {
      const controller = new AbortController();
      const promise = call({ signal: controller.signal });
      controller.abort();
      return promise;
    });
    await promiseLine(`${name}{ signal }), not aborted`, () => call({ signal: new AbortController().signal }));
    await promiseLine(`${name}{ signal: undefined })`, () => call({ signal: undefined }));
    for (const [label, value] of invalid) {
      await promiseLine(`${name}{ signal: ${label} })`, () => call({ signal: value }));
    }
    await promiseLine(`${name}{ signal: { aborted: true } })`, () => call({ signal: { aborted: true } }));
  }

  // The sync forms have no `signal`.
  for (const [name, call] of [
    ["fs.statSync(path, ", options => fs.statSync(file, options)],
    ["fs.lstatSync(path, ", options => fs.lstatSync(file, options)],
    ["fs.fstatSync(fd, ", options => fs.fstatSync(fd, options)],
  ]) {
    syncLine(`${name}{ signal: aborted })`, () => call({ signal: aborted() }));
    syncLine(`${name}{ signal: 'x' })`, () => call({ signal: "x" }));
  }

  // util.promisify() goes through the callback forms.
  await promiseLine("util.promisify(fs.stat)(path, { signal: aborted })", () =>
    promisify(fs.stat)(file, { signal: aborted() }),
  );
  await promiseLine("util.promisify(fs.lstat)(path, { signal }) then abort()", () => {
    const controller = new AbortController();
    const promise = promisify(fs.lstat)(file, { signal: controller.signal });
    controller.abort();
    return promise;
  });
  await promiseLine("util.promisify(fs.fstat)(fd, { signal }), not aborted", () =>
    promisify(fs.fstat)(fd, { signal: new AbortController().signal }),
  );
  await promiseLine("util.promisify(fs.fstat)(fd, { signal: 'x' })", () => promisify(fs.fstat)(fd, { signal: "x" }));

  // Which argument wins when two are invalid, and an abort against an operation that would fail.
  callbackLine("fs.stat(123, { signal: 'x' }, cb)", callback => fs.stat(123, { signal: "x" }, callback));
  callbackLine("fs.stat(path, { signal: 'x' }) without cb", () => fs.stat(file, { signal: "x" }));
  callbackLine("fs.stat(123, { signal: aborted }, cb)", callback => fs.stat(123, { signal: aborted() }, callback));
  callbackLine("fs.stat(path, { signal: aborted }) without cb", () => fs.stat(file, { signal: aborted() }));
  callbackLine("fs.stat(123, { signal }, cb)", callback =>
    fs.stat(123, { signal: new AbortController().signal }, callback),
  );
  callbackLine("fs.lstat(123, { signal: 'x' }, cb)", callback => fs.lstat(123, { signal: "x" }, callback));
  callbackLine("fs.lstat(123, { signal: aborted }, cb)", callback => fs.lstat(123, { signal: aborted() }, callback));
  callbackLine("fs.lstat(missing, { signal: aborted }, cb)", callback =>
    fs.lstat(missing, { signal: aborted() }, callback),
  );
  callbackLine("fs.lstat(missing, { signal }, cb) then abort()", callback => {
    const controller = new AbortController();
    fs.lstat(missing, { signal: controller.signal }, callback);
    return () => controller.abort();
  });
  callbackLine("fs.stat(missing, { signal, throwIfNoEntry: false }, cb)", callback =>
    fs.stat(missing, { signal: new AbortController().signal, throwIfNoEntry: false }, callback),
  );
  callbackLine("fs.fstat('bad', { signal: aborted }, cb)", callback =>
    fs.fstat("bad", { signal: aborted() }, callback),
  );
  callbackLine("fs.fstat(-1, { signal: aborted }, cb)", callback => fs.fstat(-1, { signal: aborted() }, callback));
  callbackLine("fs.fstat('bad', { signal: 'x' }, cb)", callback => fs.fstat("bad", { signal: "x" }, callback));
  callbackLine("fs.fstat(fd, { signal: 'x' }) without cb", () => fs.fstat(fd, { signal: "x" }));
  callbackLine("fs.fstat('bad', { signal }, cb)", callback =>
    fs.fstat("bad", { signal: new AbortController().signal }, callback),
  );
  await promiseLine("fsPromises.stat(123, { signal: aborted })", () => fsp.stat(123, { signal: aborted() }));
  await promiseLine("fsPromises.stat(123, { signal: 'x' })", () => fsp.stat(123, { signal: "x" }));
  await promiseLine("fsPromises.stat(123, { signal })", () => fsp.stat(123, { signal: new AbortController().signal }));
  await promiseLine("fsPromises.stat(missing, { signal: aborted })", () => fsp.stat(missing, { signal: aborted() }));
  await promiseLine("fsPromises.stat(missing, { signal })", () =>
    fsp.stat(missing, { signal: new AbortController().signal }),
  );
  await promiseLine("fsPromises.stat(missing, { signal, throwIfNoEntry: false })", () =>
    fsp.stat(missing, { signal: new AbortController().signal, throwIfNoEntry: false }),
  );
  await promiseLine("fsPromises.lstat(123, { signal: aborted })", () => fsp.lstat(123, { signal: aborted() }));
  {
    const closed = await fsp.open(file, "r");
    await closed.close();
    await promiseLine("closed filehandle.stat({ signal: 'x' })", () => closed.stat({ signal: "x" }));
    await promiseLine("closed filehandle.stat({ signal: aborted })", () => closed.stat({ signal: aborted() }));
  }

  // The error of an abort.
  {
    const events = line("AbortError of an abort in flight");
    const controller = new AbortController();
    const reason = new Error("why");
    fs.stat(file, { signal: controller.signal }, (error, stats) => {
      events.push(
        `name=${error?.name} code=${error?.code} cause is the reason=${error?.cause === reason} stats=${stats}`,
      );
    });
    controller.abort(reason);
  }
  {
    const events = line("AbortError of an aborted signal, promise");
    const reason = new Error("why");
    try {
      await fsp.lstat(file, { signal: AbortSignal.abort(reason) });
      events.push("resolves");
    } catch (error) {
      events.push(`name=${error?.name} code=${error?.code} cause is the reason=${error?.cause === reason}`);
    }
  }

  // A callback that throws while the call is still on the stack.
  {
    const events = line("fs.stat(path, { signal: aborted }, cb) with a cb that throws");
    try {
      fs.stat(file, { signal: aborted() }, () => {
        throw new Error("from the callback");
      });
      events.push("returns");
    } catch (error) {
      events.push(`throws out of fs.stat: ${error.message}`);
    }
  }

  // The callback is an 'abort' listener of the signal: it runs in the order of registration, inside abort().
  {
    const events = line("order among the listeners of the signal");
    const controller = new AbortController();
    controller.signal.addEventListener("abort", () => events.push("listener added before"));
    fs.stat(file, { signal: controller.signal }, error => events.push(`cb:${describe(error)}`));
    controller.signal.addEventListener("abort", () => events.push("listener added after"));
    controller.abort();
    events.push("abort() returned");
  }
  {
    const events = line("an earlier listener calls stopImmediatePropagation()");
    const controller = new AbortController();
    controller.signal.addEventListener("abort", event => {
      events.push("stops");
      event.stopImmediatePropagation();
    });
    fs.lstat(file, { signal: controller.signal }, error => events.push(`cb:${describe(error)}`));
    controller.signal.addEventListener("abort", () => events.push("listener added after"));
    controller.abort();
    events.push("abort() returned");
  }
  {
    const events = line("one signal, three operations");
    const controller = new AbortController();
    fs.stat(file, { signal: controller.signal }, error => events.push(`stat:${describe(error)}`));
    fs.lstat(file, { signal: controller.signal }, error => events.push(`lstat:${describe(error)}`));
    fs.fstat(fd, { signal: controller.signal }, error => events.push(`fstat:${describe(error)}`));
    controller.abort();
    events.push("abort() returned");
  }
  {
    const events = line("AbortSignal.any([signal])");
    const controller = new AbortController();
    let phase = "sync";
    fs.lstat(file, { signal: AbortSignal.any([controller.signal]) }, error =>
      events.push(`${describe(error)} @${phase}`),
    );
    phase = "abort()";
    controller.abort();
    phase = "later";
  }
  {
    const events = line("abort() from process.nextTick");
    const controller = new AbortController();
    fs.stat(file, { signal: controller.signal }, error => events.push(describe(error)));
    process.nextTick(() => controller.abort());
  }
  {
    const events = line("abort() after the operation called back");
    const controller = new AbortController();
    await new Promise(resolve =>
      fs.stat(file, { signal: controller.signal }, error => {
        events.push(describe(error));
        resolve();
      }),
    );
    controller.abort();
    events.push(`listeners left=${getEventListeners(controller.signal, "abort").length}`);
  }
  {
    const events = line("abort() inside the callback of the operation");
    const controller = new AbortController();
    await new Promise(resolve =>
      fs.stat(file, { signal: controller.signal }, error => {
        events.push(describe(error));
        controller.abort();
        resolve();
      }),
    );
  }

  // The AsyncLocalStorage store that the callback sees.
  {
    const events = line("AsyncLocalStorage store");
    const storage = new AsyncLocalStorage();
    const controller = new AbortController();
    storage.run("the call", () =>
      fs.stat(file, { signal: controller.signal }, () => events.push(`abort in flight sees ${storage.getStore()}`)),
    );
    storage.run("the abort", () => controller.abort());
    storage.run("the call", () =>
      fs.stat(file, { signal: aborted() }, () => events.push(`aborted signal sees ${storage.getStore()}`)),
    );
  }

  // The listener is added with the signal's own addEventListener, and removed when the operation is over.
  for (const [name, call] of [
    ["fs.stat(path, { signal }, cb)", (signal, done) => fs.stat(file, { signal }, done)],
    ["fs.fstat(fd, { signal }, cb)", (signal, done) => fs.fstat(fd, { signal }, done)],
    ["fsPromises.stat(path, { signal })", (signal, done) => fsp.stat(file, { signal }).then(done, done)],
    ["filehandle.stat({ signal })", (signal, done) => handle.stat({ signal }).then(done, done)],
  ]) {
    const events = line(`${name}: calls of addEventListener / removeEventListener`);
    const { signal } = new AbortController();
    let added = 0;
    let removed = 0;
    const { addEventListener, removeEventListener } = signal;
    signal.addEventListener = function (type) {
      if (type === "abort") added++;
      return addEventListener.apply(this, arguments);
    };
    signal.removeEventListener = function (type) {
      if (type === "abort") removed++;
      return removeEventListener.apply(this, arguments);
    };
    await new Promise(resolve => call(signal, resolve));
    // The promise forms remove the listener when the operation has settled, which is after `done` ran.
    await null;
    events.push(`${added} / ${removed}, listeners left=${getEventListeners(signal, "abort").length}`);
  }
  {
    const events = line("50 operations on one signal: listeners while they run / after");
    const controller = new AbortController();
    let left = 50;
    await new Promise(resolve => {
      for (let i = 0; i < 50; i++) {
        fs.stat(file, { signal: controller.signal }, () => {
          if (--left === 0) resolve();
        });
      }
      events.push(String(getEventListeners(controller.signal, "abort").length));
    });
    events.push(String(getEventListeners(controller.signal, "abort").length));
  }
  {
    const events = line("an object with aborted, addEventListener and removeEventListener");
    let added = 0;
    let removed = 0;
    const signal = {
      aborted: false,
      addEventListener() {
        added++;
      },
      removeEventListener() {
        removed++;
      },
    };
    await new Promise(resolve =>
      fs.stat(file, { signal }, error => {
        events.push(describe(error));
        resolve();
      }),
    );
    events.push(`add / remove = ${added} / ${removed}`);
  }

  // A promise form that lost against the abort must not report its own failure as an unhandled rejection.
  {
    const events = line("fsPromises.stat(missing, { signal }) then abort()");
    const controller = new AbortController();
    const promise = fsp.stat(missing, { signal: controller.signal });
    controller.abort();
    setImmediate(() => events.push("setImmediate"));
    await promise.then(
      () => events.push("resolves"),
      error => events.push(`rejects ${describe(error)}`),
    );
  }

  await handle.close();
}

let unhandledRejections = 0;
process.on("unhandledRejection", () => unhandledRejections++);

let printed = false;
process.on("beforeExit", () => {
  if (printed) return;
  printed = true;
  fs.closeSync(fd);
  fs.rmSync(dir, { recursive: true, force: true });
  line("unhandled rejections").push(String(unhandledRejections));
  const width = Math.max(...lines.map(([label]) => label.length)) + 2;
  console.log(lines.map(([label, events]) => `${label.padEnd(width)}${events.join(" | ") || "(nothing)"}`).join("\n"));
});

main();
