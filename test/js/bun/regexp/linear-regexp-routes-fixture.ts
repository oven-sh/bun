// Run by linear-regexp.test.ts, with and without --experimental-linear-regexp. The first argument
// says what to report; the report is one line of JSON. No report here reads the statistics of a
// match, so the main thread does not load bun:internal-for-testing, which takes a debug build
// more than a second.
import { fork } from "node:child_process";
import { Worker } from "node:worker_threads";

const repeat = (text: string, count: number) => Buffer.alloc(text.length * count, text).toString();

// A backtracking engine takes 2^64 ways through this subject, stops at its limit, and answers
// "no match". So a match says that the non-backtracking matcher ran.
const onlyTheMatcherMatches = /(a*)*b|a*!/;
const manyA = repeat("a", 64) + "!";

// What a Worker runs: it posts whether the matcher ran in it.
const probe = `
  const matches = /(a*)*b|a*!/.test(${JSON.stringify(manyA)});
  if (typeof postMessage === "function") postMessage(matches);
  else require("node:worker_threads").parentPort.postMessage(matches);`;

// What the Worker posted, or the error its constructor threw.
const describeError = (error: any) => ({ name: error.name, code: error.code, message: error.message });
const startGlobalWorker = (options: object = {}) =>
  new Promise(resolve => {
    const url = URL.createObjectURL(new Blob([probe]));
    try {
      const worker = new globalThis.Worker(url, options);
      worker.onmessage = event => {
        resolve(event.data);
        worker.terminate();
      };
      worker.onerror = event => resolve("error event: " + event.message);
    } catch (error) {
      resolve(describeError(error));
    }
  });
const startNodeWorker = (options: object = {}) =>
  new Promise(resolve => {
    try {
      const worker = new Worker(probe, { eval: true, ...options });
      worker.on("message", resolve);
      worker.on("error", error => resolve("error event: " + error.message));
    } catch (error) {
      resolve(describeError(error));
    }
  });

const reports: Record<string, () => unknown> = {
  // Every way a program reaches a RegExp, then a Worker.
  routes: async () => {
    const results = {
      test: /(a*)*b|a*!/.test(manyA),
      exec: /(a*)*b|a*!/.exec(manyA)?.index,
      search: manyA.search(/(a*)*b|a*!/),
      replace: manyA.replace(/(a*)*b|a*!/, "").length,
      match: manyA.match(/(?:a*)*b|a*!/g)?.length,
      matchAll: [...manyA.matchAll(/(?:a*)*b|a*!/g)].length,
      split: manyA.split(/(?:a*)*b|a*!/).length,
    };
    return { results, worker: await startGlobalWorker() };
  },

  // A child of child_process.fork() gets the execArgv of this process.
  fork: () =>
    new Promise((resolve, reject) => {
      const child = fork(import.meta.filename, ["forked"], { stdio: ["ignore", "ignore", "inherit", "ipc"] });
      child.on("message", message => {
        resolve(message);
        child.kill();
      });
      child.on("error", reject);
    }),

  forked: () => {
    process.send!(onlyTheMatcherMatches.test(manyA));
    return undefined;
  },

  // The filter of a Bun.build plugin does not run as a RegExp object. The bundler takes its
  // pattern and matches it on the bundler's threads.
  pluginFilter: async () => {
    const resolved: string[] = [];
    const build = await Bun.build({
      entrypoints: ["/entry.js"],
      files: { "/entry.js": `import value from ${JSON.stringify(manyA)};\nconsole.log(value);` },
      plugins: [
        {
          name: "only-the-matcher-matches",
          setup(build) {
            build.onResolve({ filter: onlyTheMatcherMatches }, ({ path }) => {
              resolved.push(path);
              return { path, namespace: "matched" };
            });
            build.onLoad({ filter: /(?:)/, namespace: "matched" }, () => ({
              contents: "export default 'from the plugin';",
              loader: "js",
            }));
          },
        },
      ],
      throw: false,
    });
    return { success: build.success, resolved: resolved.map(path => path === manyA), logs: build.logs.length };
  },

  limits: () => ({
    matchLimit: onlyTheMatcherMatches.test(manyA),
    contextPool: /^(?:a|b)+$/.test(repeat("a", 262144)),
  }),

  // What a Worker does when its execArgv has the switch, from node:worker_threads and from the
  // global constructor. In a process that has the switch, also a Worker whose execArgv is empty.
  workerExecArgv: async () => {
    const flag = "--experimental-linear-regexp";
    const hasSwitch = process.execArgv.includes(flag);
    const [given, givenGlobal, empty] = await Promise.all([
      startNodeWorker({ execArgv: [flag] }),
      startGlobalWorker({ execArgv: [flag] }),
      // Without the switch the probe of this Worker runs to the limit of the backtracking engine.
      hasSwitch ? startGlobalWorker({ execArgv: [] }) : undefined,
    ]);
    return { given, givenGlobal, empty };
  },
};

const report = await reports[process.argv[2]]();
if (report !== undefined) {
  console.log(JSON.stringify(report));
  process.exit(0);
}
