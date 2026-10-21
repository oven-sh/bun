// Prints what fs.watch, fs.promises.watch and fs.watchFile do with values of their boolean options.
// It uses only node APIs: fs.watch.test.ts runs it under bun and under node and compares the outputs.
// The arguments are an empty directory to watch, the section to run, and the arguments of the section.
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const dir = process.argv[2];

const values = ["undefined", "null", "true", "false", "0", "1", "NaN", '""', '"yes"', "{}"];
const evaluate = source => (0, eval)(`(${source})`);

function thrown(e) {
  return `throws ${e.code}: ${e.message}`;
}

function watch(options, target = dir) {
  try {
    fs.watch(target, options).close();
    return "watches";
  } catch (e) {
    return thrown(e);
  }
}

// Node reports an invalid option on the first next(). A valid watch ends here with the abort.
async function promisesWatch(options, filename = dir) {
  const controller = new AbortController();
  try {
    if (typeof options === "object") options = { signal: controller.signal, ...options };
    const iterator = fs.promises.watch(filename, options)[Symbol.asyncIterator]();
    const next = iterator.next();
    controller.abort();
    await next;
    return "watches";
  } catch (e) {
    return e.name === "AbortError" ? "watches" : thrown(e);
  }
}

// The path does not exist, so the listener gets zeroed stats at once.
function watchFileStats(options, name) {
  const missing = path.join(dir, name);
  return new Promise(resolve => {
    try {
      fs.watchFile(missing, options, curr => {
        fs.unwatchFile(missing);
        resolve(`gives ${curr.constructor.name}`);
      });
    } catch (e) {
      resolve(thrown(e));
    }
  });
}

// Opens the watcher that `row` is the source of, and returns the function that closes it.
// A row can use `dir`, `file` (a path that does not exist), `signal` and `listener`.
function open(row, i) {
  const controller = new AbortController();
  const signal = controller.signal;
  const file = path.join(dir, `missing-${i}`);
  const listener = () => {};
  const opened = eval(row);
  if (row.startsWith("fs.watchFile(")) return () => fs.unwatchFile(file);
  if (!row.startsWith("fs.promises.watch(")) return () => opened.close();
  // Node opens the native watcher on the first next(). If node rejects the options there, nothing is open.
  opened[Symbol.asyncIterator]()
    .next()
    .catch(() => {});
  return () => controller.abort();
}

// For the order sections: only the code and the name are printed. The rest of some of these messages is not node's.
const subject = outcome =>
  outcome.replace(/^(throws \w+)(?:: The "([\w.]+)" (?:argument|property))?.*$/, (_, code, name) =>
    name ? `${code} about ${name}` : code,
  );

const sections = {
  async "fs.watch"() {
    for (const v of values) console.log(`fs.watch(dir, { persistent: ${v} })`, watch({ persistent: evaluate(v) }));
    for (const v of values) console.log(`fs.watch(dir, { recursive: ${v} })`, watch({ recursive: evaluate(v) }));
    for (const v of values) {
      const outcome = watch({ recursive: true, persistent: evaluate(v) });
      console.log(`fs.watch(dir, { recursive: true, persistent: ${v} })`, outcome);
    }
    console.log("fs.watch(dir, 123)", watch(123));
    console.log('fs.watch(dir, "buffer")', watch("buffer"));
    console.log("fs.watch(dir, null)", watch(null));
  },

  // Which error wins, off macOS and Windows: only node's non-native recursive watcher validates in fs.watch.
  async "fs.watch order"() {
    const rows = [
      ['fs.watch(123, { recursive: "yes" })', () => watch({ recursive: "yes" }, 123)],
      ['fs.watch(dir, { recursive: "yes", encoding: "bogus" })', () => watch({ recursive: "yes", encoding: "bogus" })],
      ['fs.watch(dir, { recursive: "yes", signal: "bad" })', () => watch({ recursive: "yes", signal: "bad" })],
      ['fs.watch(dir, { recursive: "yes", persistent: "x" })', () => watch({ recursive: "yes", persistent: "x" })],
      ['fs.watch(dir, { recursive: "yes", ignore: 123 })', () => watch({ recursive: "yes", ignore: 123 })],
    ];
    for (const [label, run] of rows) console.log(label, subject(run()));
  },

  // Which error wins. Node has one order off macOS and Windows and another order on them.
  async "fs.promises.watch order"() {
    const rows = [
      [
        'fs.promises.watch(dir, { recursive: "yes", persistent: "x" })',
        () => promisesWatch({ recursive: "yes", persistent: "x" }),
      ],
      ["fs.promises.watch(pathWithNul, { persistent: 1 })", () => promisesWatch({ persistent: 1 }, dir + "\0")],
      ["fs.promises.watch(pathWithNul, { recursive: 0 })", () => promisesWatch({ recursive: 0 }, dir + "\0")],
      [
        "fs.promises.watch(pathWithNul, { recursive: true, persistent: 1 })",
        () => promisesWatch({ recursive: true, persistent: 1 }, dir + "\0"),
      ],
      ["fs.promises.watch(pathWithNul, 1)", () => promisesWatch(1, dir + "\0")],
    ];
    for (const [label, run] of rows) console.log(label, subject(await run()));
  },

  async "fs.promises.watch"() {
    for (const v of values) {
      console.log(`fs.promises.watch(dir, { persistent: ${v} })`, await promisesWatch({ persistent: evaluate(v) }));
    }
    for (const v of values) {
      console.log(`fs.promises.watch(dir, { recursive: ${v} })`, await promisesWatch({ recursive: evaluate(v) }));
    }
    for (const v of values) {
      const outcome = await promisesWatch({ recursive: true, persistent: evaluate(v) });
      console.log(`fs.promises.watch(dir, { recursive: true, persistent: ${v} })`, outcome);
    }
    const aborted = await promisesWatch({ persistent: 1, signal: AbortSignal.abort() });
    console.log("fs.promises.watch(dir, { persistent: 1, signal: AbortSignal.abort() })", aborted);
    console.log(
      "fs.promises.watch(dir, { persistent: 1, ignore: 123 })",
      await promisesWatch({ persistent: 1, ignore: 123 }),
    );
    console.log("fs.promises.watch(dir, 1)", await promisesWatch(1));
  },

  async "fs.watchFile"() {
    const options = [...values.map(v => `{ bigint: ${v} }`), "Object.create({ bigint: true })"];
    const outcomes = await Promise.all(options.map((source, i) => watchFileStats(evaluate(source), `missing-${i}`)));
    options.forEach((source, i) => console.log(`fs.watchFile(file, ${source}, listener)`, outcomes[i]));
  },

  // The arguments are the rows that keep the process alive, "--", and the rows that let it exit.
  // An unref'd timer does not keep the process alive, so it runs only while an open watcher does.
  async "keep-alive"(rows) {
    const keeps = rows.slice(0, rows.indexOf("--"));
    const exits = rows.slice(keeps.length + 1);
    // One watcher is open at a time: each row printed is a watcher that kept the process alive by itself.
    (function next(i) {
      if (i === keeps.length) return openTheRest();
      const close = open(keeps[i], i);
      setTimeout(() => {
        console.log(keeps[i]);
        close();
        next(i + 1);
      }, 50).unref();
    })(0);
    // Then all the other watchers are open, and the process has to exit with no more rows printed.
    // If one keeps it alive, the timer closes them in order: the last row printed is one that did.
    function openTheRest() {
      const closers = exits.map((row, i) => open(row, keeps.length + i));
      (function closeNext(i, delay) {
        if (i === exits.length) return;
        setTimeout(() => {
          console.log(exits[i]);
          closers[i]();
          closeNext(i + 1, 50);
        }, delay).unref();
      })(0, 2000);
    }
  },
};

sections[process.argv[3]](process.argv.slice(4));
