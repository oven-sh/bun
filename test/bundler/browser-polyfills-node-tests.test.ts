// Runs alone: it starts hundreds of processes, twenty at a time.
import { afterAll, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, tempDir } from "harness";
import { availableParallelism } from "os";
import { basename, dirname, join } from "path";
import { failing, passing } from "./browser-polyfills-node-tests.list";

// Node's own tests for the modules that `--target=browser` polyfills (src/node-fallbacks). Each test file is one entry
// point of a browser build, and its bundle runs in a process of its own, as the file does under Node.
// browser-polyfills-node-tests.list.ts has the files that pass and the files that fail. This command writes it:
const update = "BROWSER_POLYFILLS_UPDATE=1 bun bd test test/bundler/browser-polyfills-node-tests.test.ts";
const updating = !!process.env.BROWSER_POLYFILLS_UPDATE;
const nodeTests = join(import.meta.dir, "..", "js", "node", "test", "parallel");

// What the update takes. Node names a test file after its module: `tests`. A file has to use the polyfill: it requires
// it, or it `reads` a global that the polyfill stands for.
// Not here: `console`, `os`, `timers` and `tty` are stubs or the host's own objects, and most of Node's tests for
// `crypto` need `../common/crypto`, key objects or OpenSSL.
const modules: Record<string, { tests: string[]; reads?: RegExp }> = {
  assert: { tests: ["assert"] },
  buffer: { tests: ["buffer"], reads: /\bBuffer\b/ },
  domain: { tests: ["domain"] },
  events: { tests: ["events", "event-emitter", "eventemitter"] },
  path: { tests: ["path"] },
  // Of `process` the polyfill implements `nextTick`.
  process: { tests: ["next-tick", "process-next-tick"], reads: /\bprocess\.nextTick\b/ },
  punycode: { tests: ["punycode"] },
  querystring: { tests: ["querystring"] },
  stream: { tests: ["stream", "stream2", "stream3", "streams", "readable"] },
  string_decoder: { tests: ["string-decoder"] },
  sys: { tests: ["sys"] },
  url: { tests: ["url"] },
  util: { tests: ["util"] },
  zlib: { tests: ["zlib"] },
};
// One run cannot tell these from the rest.
const leftOutByName: Record<string, string> = {
  "test-buffer-tostring-rangeerror.js": "takes more than a minute",
  "test-events-uncaught-exception-stack.js": "returns at once on Windows",
  "test-string-decoder-fuzz.js": "its input is random",
  "test-util-inspect-long-running.js": "takes more than a minute",
};
function candidates() {
  const polyfills = readdirSync(join(import.meta.dir, "..", "..", "src", "node-fallbacks"))
    .filter(file => file.endsWith(".js"))
    .map(file => file.slice(0, -".js".length));
  // Node's tests for `http`, `https` and `net` start a server, which no polyfill has.
  const servers = ["http", "https", "net"];
  const allowed = new Set([...polyfills.filter(name => !servers.includes(name)), "../common", "../common/fixtures"]);
  const transpiler = new Bun.Transpiler({ loader: "js" });
  return readdirSync(nodeTests)
    .filter(file => {
      const module = Object.keys(modules).find(name =>
        modules[name].tests.some(
          t => file === `test-${t}.js` || (file.startsWith(`test-${t}-`) && file.endsWith(".js")),
        ),
      );
      if (!module || file in leftOutByName) return false;
      const source = readFileSync(join(nodeTests, file), "utf8");
      const requires = transpiler.scanImports(source).map(({ path }) => path.replace(/^node:/, ""));
      const uses = requires.includes(module) || !!modules[module].reads?.test(source);
      return uses && requires.every(path => allowed.has(path));
    })
    .sort();
}

// A page has none of these, so a bundle must not find bun's. `../common` stays outside the bundle, and it and bun's
// own modules under it run in the same process and need them. So the build hides them from the bundle only: a free
// name is `undefined`, and `globalThis` is a view of the global object without them.
const nodeGlobals = ["process", "Buffer", "global", "setImmediate", "clearImmediate"];
const define = {
  globalThis: "pageGlobalThis",
  self: "pageGlobalThis",
  ...Object.fromEntries(nodeGlobals.map(name => [name, "undefined"])),
};
const dir = tempDir("browser-polyfills-node-tests", {
  // `require` and not `import()`: what a file throws as it loads is then an uncaught exception, as under Node.
  "page.js": /* js */ `
    const nodeGlobals = new Set(${JSON.stringify(nodeGlobals)});
    globalThis.pageGlobalThis = new Proxy(globalThis, {
      get: (target, key) => (nodeGlobals.has(key) ? undefined : Reflect.get(target, key)),
      has: (target, key) => !nodeGlobals.has(key) && Reflect.has(target, key),
    });
    require(process.argv[2]);
  `,
});
afterAll(() => dir[Symbol.dispose]());

// A Node.js test file reads these names as globals, and the bundler binds none of them (#5894). So a file gets them
// as arguments, from the polyfills. `process` also has the listener methods of the host: a test checks its result in
// `process.on("exit")`, and the polyfill ignores listeners.
const globalsOfATestFile = join(import.meta.dir, "globals-of-a-node-test-file.js");
const globalsOfATestFileSource = /* js */ `
  import host from "process of the host";
  import { Buffer } from "node:buffer";
  import * as polyfill from "node:process";
  import { clearImmediate, setImmediate } from "node:timers";
  const listeners = [
    ...["on", "once", "off", "addListener", "removeListener", "removeAllListeners"],
    ...["prependListener", "prependOnceListener", "listeners", "emit"],
  ].map(name => [name, host[name].bind(host)]);
  export const process = { ...polyfill, ...Object.fromEntries(listeners) };
  export { Buffer, clearImmediate, setImmediate };
`;
// The inner function keeps a file's own `const { Buffer } = require("buffer")` legal.
const withGlobals = (source: string) =>
  `(function ({ process, Buffer, setImmediate, clearImmediate }) { return function () {${source}\n` +
  `}.call(this); }).call(this, require(${JSON.stringify(globalsOfATestFile)}));`;

// What the harness has to report as a failure. Each is an entry point like a file of Node's.
const mustFail: Record<string, { source: string; prints: string }> = {
  "a-throw-in-a-tick.js": {
    source: `require("../common"); process.nextTick(() => { throw new Error("thrown in a tick"); });`,
    prints: "thrown in a tick",
  },
  "an-unmet-mustCall.js": {
    source: `require("../common").mustCall();`,
    prints: "Mismatched noop function calls. Expected exactly 1, actual 0.",
  },
};

// One build for all files. A file that is gone or does not build stays out of it, and its name maps to why.
async function bundle(names: string[]) {
  const unbuilt = new Map<string, string>();
  const files: Record<string, string> = { [globalsOfATestFile]: globalsOfATestFileSource };
  for (const name of names) {
    const path = join(nodeTests, name);
    if (name in mustFail) files[path] = withGlobals(mustFail[name].source);
    else if (existsSync(path)) files[path] = withGlobals(readFileSync(path, "utf8"));
    else unbuilt.set(name, "is not in test/js/node/test/parallel");
  }
  for (;;) {
    const result = await Bun.build({
      entrypoints: names.filter(name => !unbuilt.has(name)).map(name => join(nodeTests, name)),
      files,
      root: nodeTests,
      outdir: String(dir),
      target: "browser",
      splitting: true,
      define,
      throw: false,
      plugins: [
        {
          name: "the host of a Node.js test",
          setup(build) {
            build.onResolve({ filter: /^\.\.\/common(\/|$)/ }, ({ path, importer }) => ({
              path: require.resolve(join(dirname(importer), path)).replaceAll("\\", "/"),
              external: true,
            }));
            build.onResolve({ filter: /^process of the host$/ }, () => ({ path: "node:process", external: true }));
          },
        },
      ],
    });
    if (result.success) return unbuilt;
    const before = unbuilt.size;
    for (const { level, message, position } of result.logs) {
      const name = basename(position?.file ?? "");
      if (level === "error" && names.includes(name)) unbuilt.set(name, `does not build: ${message}`);
    }
    if (unbuilt.size === before) throw new AggregateError(result.logs, "the build fails outside of a test file");
  }
}
// A debug or ASAN build takes seconds for one process, so there only `passing` is built and run.
const known = isDebug || isASAN ? passing : [...passing, ...failing];
const names = updating ? candidates() : [...known, ...Object.keys(mustFail)];
const unbuilt = await bundle(names);

async function run(name: string) {
  const why = unbuilt.get(name);
  if (why) throw new Error(`${name} ${why}. This takes it off the list: ${update}`);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "page.js", join(String(dir), name)],
    cwd: String(dir),
    env: bunEnv,
    stdio: ["ignore", "pipe", "pipe"],
    // A test has no time limit on a debug build (below), so a bundle that never exits has one here.
    timeout: (isDebug ? 10 : 1) * 60_000,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { exitCode, signalCode: proc.signalCode, stdout, stderr };
}

// A debug build takes seconds to start one process. As for itBundled, a test has no time limit there.
const timeout = isDebug ? Infinity : undefined;

if (!updating) {
  test.concurrent.each(passing)(
    "%s",
    async name => {
      const { exitCode, stdout, stderr } = await run(name);
      const hint = `${name} passed as a browser bundle. If it cannot pass any more, this moves it to \`failing\`: ${update}`;
      expect(exitCode, `${stdout}${stderr}\n${hint}`).toBe(0);
    },
    timeout,
  );

  // A failed Node.js test exits by itself, with a code other than 0.
  test.concurrent.skipIf(isDebug || isASAN).each(failing)(
    "%s fails",
    async name => {
      const { exitCode, signalCode, stdout, stderr } = await run(name);
      const hint = `${name} failed as a browser bundle. If it passes now, this moves it to \`passing\`: ${update}`;
      expect(exitCode, `${stdout}${stderr}\n${hint}`).not.toBe(0);
      expect(signalCode, stdout + stderr).toBeNull();
    },
    timeout,
  );

  test.concurrent.each(Object.keys(mustFail))(
    "the harness reports %s",
    async name => {
      const { exitCode, stdout, stderr } = await run(name);
      expect(stdout + stderr).toContain(mustFail[name].prints);
      expect(exitCode).toBe(1);
    },
    timeout,
  );
}

// The first thing that a failed bundle prints: the error, below the lines of source that bun quotes above it.
function firstLine(output: string) {
  const lines = output.split("\n").filter(line => line.trim() && !/^\s*(\d+ \||\^+$)|^\+ actual - expected/.test(line));
  const end = lines.findIndex(line => /^\s+(at |\w+: )/.test(line));
  const text = lines
    .slice(0, end < 1 ? 1 : end)
    .join(" ")
    .replace(/ at \S+:\d+:\d+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 110 ? text.slice(0, 109) + "…" : text;
}

if (updating) {
  test(
    "write browser-polyfills-node-tests.list.ts",
    async () => {
      const leftOut = Object.entries(leftOutByName).map(([name, why]) => `${name}: ${why}`);
      for (const [name, why] of unbuilt) leftOut.push(`${name}: ${firstLine(why)}`);
      const built = names.filter(name => !unbuilt.has(name));
      const verdicts: Awaited<ReturnType<typeof run>>[] = [];
      const width = Math.max(1, Math.floor(availableParallelism() / 2));
      for (let at = 0; at < built.length; at += width) {
        verdicts.push(...(await Promise.all(built.slice(at, at + width).map(run))));
      }
      const nowPassing: string[] = [];
      const nowFailing: string[] = [];
      let failed = 0;
      let last = "";
      for (const [index, { exitCode, signalCode, stdout, stderr }] of verdicts.entries()) {
        const name = built[index];
        if (exitCode === null) leftOut.push(`${name}: is killed by ${signalCode}`);
        else if (exitCode !== 0) {
          const line = firstLine(stderr + stdout);
          if (line !== last) nowFailing.push(`  // ${line}`);
          nowFailing.push(`  ${JSON.stringify(name)},`);
          last = line;
          failed++;
        } else if (/^1\.\.0 # Skipped/m.test(stdout)) leftOut.push(`${name}: skips itself`);
        else nowPassing.push(`  ${JSON.stringify(name)},`);
      }
      writeFileSync(
        join(import.meta.dir, "browser-polyfills-node-tests.list.ts"),
        [
          `// Written by \`${update}\`.`,
          "// Do not edit it by hand. browser-polyfills-node-tests.test.ts says which files are here.",
          "",
          "// Each of these files of test/js/node/test/parallel passes as a browser bundle.",
          "export const passing: string[] = [",
          ...nowPassing,
          "];",
          "",
          "// Each of these fails. Above a file, or a run of files: what it prints first.",
          "export const failing: string[] = [",
          ...nowFailing,
          "];",
          "",
          "// Left out:",
          ...leftOut.sort().map(line => `// ${line}`),
          "",
        ].join("\n"),
      );
      console.log(`${nowPassing.length} pass, ${failed} fail, ${leftOut.length} are left out`);
    },
    Infinity,
  );
}
