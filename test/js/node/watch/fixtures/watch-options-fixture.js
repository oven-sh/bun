// Prints what fs.watch, fs.promises.watch and fs.watchFile do with values of their boolean options.
// It uses only node APIs: fs.watch.test.ts runs it under bun and under node and compares the outputs.
"use strict";
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "watch-options-"));

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
    const iterator = fs.promises.watch(filename, { signal: controller.signal, ...options })[Symbol.asyncIterator]();
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

// One child per watcher. Its script calls probe() when the watcher is open. An unref'd timer does not
// keep the process alive, so it runs only if the watcher does. The delay is long: a timer that is
// already due runs at the end of the loop iteration that set it, even when nothing else is alive.
function keepsAlive(body) {
  const script = `
    const fs = require("node:fs");
    const dir = ${JSON.stringify(dir)};
    const missing = ${JSON.stringify(path.join(dir, "missing"))};
    function probe(close) {
      setTimeout(() => {
        console.log("alive");
        close();
      }, 500).unref();
    }
    ${body}
  `;
  return new Promise(resolve => {
    const child = spawn(process.execPath, ["-e", script], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => (stdout += chunk));
    child.stderr.on("data", chunk => (stderr += chunk));
    child.on("close", code => {
      if (code !== 0 || stderr !== "") resolve(`fails with exit code ${code}: ${stderr.trim().split("\n")[0]}`);
      else resolve(stdout.includes("alive") ? "keeps the process alive" : "lets the process exit");
    });
  });
}

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
  // Only the code and the name are printed. The rest of some of these messages is not node's.
  async "order"() {
    const subject = outcome =>
      outcome.replace(/^(throws \w+)(?:: The "([\w.]+)" (?:argument|property))?.*$/, (_, code, name) =>
        name ? `${code} about ${name}` : code,
      );
    const rows = [
      ['fs.watch(123, { recursive: "yes" })', () => watch({ recursive: "yes" }, 123)],
      ['fs.watch(dir, { recursive: "yes", encoding: "bogus" })', () => watch({ recursive: "yes", encoding: "bogus" })],
      ['fs.watch(dir, { recursive: "yes", signal: "bad" })', () => watch({ recursive: "yes", signal: "bad" })],
      ['fs.watch(dir, { recursive: "yes", persistent: "x" })', () => watch({ recursive: "yes", persistent: "x" })],
      ['fs.watch(dir, { recursive: "yes", ignore: 123 })', () => watch({ recursive: "yes", ignore: 123 })],
      [
        'fs.promises.watch(dir, { recursive: "yes", persistent: "x" })',
        () => promisesWatch({ recursive: "yes", persistent: "x" }),
      ],
      ["fs.promises.watch(pathWithNul, { persistent: 1 })", () => promisesWatch({ persistent: 1 }, dir + "\0")],
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
    let nonObject = "watches";
    try {
      await fs.promises.watch(dir, 1)[Symbol.asyncIterator]().next();
    } catch (e) {
      nonObject = thrown(e);
    }
    console.log("fs.promises.watch(dir, 1)", nonObject);
  },

  async "fs.watchFile"() {
    const options = [...values.map(v => `{ bigint: ${v} }`), "Object.create({ bigint: true })"];
    const outcomes = await Promise.all(options.map((source, i) => watchFileStats(evaluate(source), `missing-${i}`)));
    options.forEach((source, i) => console.log(`fs.watchFile(path, ${source})`, outcomes[i]));
  },

  async "fs.watch keep-alive"() {
    const cases = [
      "fs.watch(dir)",
      "fs.watch(dir, { persistent: true })",
      "fs.watch(dir, { persistent: false })",
      "fs.watch(dir, { persistent: null })",
      'fs.watch(dir, { persistent: "" })',
      "fs.watch(dir, { persistent: 0 })",
      "fs.watch(dir, { persistent: 1 })",
      "fs.watch(dir, { recursive: true, persistent: null })",
      "fs.watch(dir, { persistent: false }).ref()",
    ];
    const outcomes = await Promise.all(
      cases.map(open => keepsAlive(`const watcher = ${open}; probe(() => watcher.close());`)),
    );
    cases.forEach((open, i) => console.log(open, outcomes[i]));
  },

  // Node opens the native watcher on the first next().
  async "fs.promises.watch keep-alive"() {
    const cases = [
      "{}",
      "{ persistent: false }",
      "{ recursive: true }",
      "{ persistent: false, recursive: true }",
      "{ recursive: true, persistent: null }",
    ];
    const outcomes = await Promise.all(
      cases.map(options =>
        keepsAlive(`
          const controller = new AbortController();
          const watcher = fs.promises.watch(dir, { ...${options}, signal: controller.signal });
          watcher[Symbol.asyncIterator]().next().catch(() => {});
          probe(() => controller.abort());
        `),
      ),
    );
    cases.forEach((options, i) => console.log(`fs.promises.watch(dir, ${options})`, outcomes[i]));
  },

  // The first stat keeps the process alive by itself. The listener runs when it is done: the path does not exist.
  async "fs.watchFile keep-alive"() {
    const cases = [
      "{}",
      "{ persistent: undefined }",
      "{ persistent: true }",
      "{ persistent: false }",
      "{ persistent: null }",
      "{ persistent: 0 }",
      "{ persistent: 1 }",
      "Object.create({ persistent: false })",
    ];
    const outcomes = await Promise.all(
      cases.map(options =>
        keepsAlive(`fs.watchFile(missing, ${options}, () => probe(() => fs.unwatchFile(missing)));`),
      ),
    );
    cases.forEach((options, i) => console.log(`fs.watchFile(path, ${options})`, outcomes[i]));
  },
};

sections[process.argv[2]]().finally(() => fs.rmSync(dir, { recursive: true, force: true }));
