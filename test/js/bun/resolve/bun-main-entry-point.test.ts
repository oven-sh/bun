import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, forEachLine, isASAN, isDebug, isWindows, tempDir } from "harness";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

// `bun:main` is backed by ServerEntryPoint.contents — a slice that is
// regenerated on every hot-reload cycle. Previously the backing
// `logger.Source` defaulted to `undefined`, so any read of
// `entry_point.source.contents` that wasn't paired with a successful
// `generate()` dereferenced garbage (high non-null fault in
// toBunStringComptime). These tests exercise the read path directly and
// the regenerate path under --hot so ASAN covers the new
// free-then-reallocate on each reload.

function stripAsanWarning(stderr: string): string[] {
  return stderr.split("\n").filter(l => l.length > 0 && !l.startsWith("WARNING: ASAN interferes"));
}

test.concurrent("dynamic import('bun:main') returns the wrapper module", async () => {
  using dir = tempDir("bun-main-dyn", {
    // package.json disables auto-install so a regression in the bun:main alias
    // cannot silently fall through to fetching the npm `main` package.
    "package.json": "{}",
    // bun:main statically imports entry.mjs, so awaiting import("bun:main")
    // at the top level of entry.mjs is a TLA self-cycle that never resolves.
    // Defer the import to a .then() so entry.mjs (and therefore bun:main)
    // can finish evaluating first.
    "entry.mjs": `
      import("bun:main").then(m => {
        if (m[Symbol.toStringTag] !== "Module") throw new Error("expected module namespace, got " + Object.prototype.toString.call(m));
        // The wrapper has no named exports. The npm \`main\` package (what this
        // resolved to before the alias fix) exports {default,length,name,prototype}.
        const keys = Object.keys(m);
        if (keys.length !== 0) throw new Error("expected empty wrapper namespace, got keys: " + keys.join(","));
        console.log("OK");
      }).catch(e => {
        console.error(String(e));
        process.exit(1);
      });
    `,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "./entry.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr: stripAsanWarning(stderr), exitCode, signalCode: proc.signalCode }).toEqual({
    stdout: "OK\n",
    stderr: [],
    exitCode: 0,
    signalCode: null,
  });
});

test.concurrent("import('bun:main') from a preload (before the module map is populated)", async () => {
  using dir = tempDir("bun-main-preload", {
    "package.json": "{}",
    "preload.mjs": `
      const m = await import("bun:main");
      if (m[Symbol.toStringTag] !== "Module") throw new Error("expected module namespace");
      console.log("PRELOAD_OK");
    `,
    "entry.mjs": `console.log("ENTRY_OK");`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "--preload", "./preload.mjs", "./entry.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  // import("bun:main") evaluates the wrapper, which evaluates entry.mjs, so
  // ENTRY_OK prints before the preload's await resumes.
  expect({ stdout, stderr: stripAsanWarning(stderr), exitCode, signalCode: proc.signalCode }).toEqual({
    stdout: "ENTRY_OK\nPRELOAD_OK\n",
    stderr: [],
    exitCode: 0,
    signalCode: null,
  });
});

const isSlowBuild = isDebug || isASAN;
// A reload test spawns a child and waits for several reloads. A debug build on
// a busy machine needs more than the default 5 s for that (measured: up to 7 s).
const reloadTestTimeout = isSlowBuild ? 60_000 : 30_000;
// How long a --hot or --watch child can print nothing before its entry is saved again.
const resaveAfter = isSlowBuild ? 10_000 : 3_000;
// Every test of this file starts a process, and twenty tests run at once. A debug build then needs more than the default 5 s for one.
if (isSlowBuild) setDefaultTimeout(reloadTestTimeout);

/**
 * Runs `dir/filename` under `--hot` or `--watch`. A test drives it from the
 * outside: it saves the entry, then waits for a line the new generation prints.
 */
function spawnEntry(mode: "--hot" | "--watch", dir: string, filename: string, contents: string) {
  const entry = join(dir, filename);
  writeFileSync(entry, contents);
  const proc = Bun.spawn({
    cmd: [bunExe(), mode, entry],
    env: bunEnv,
    // On Windows the watcher ignores files outside the working directory.
    cwd: dir,
    stdout: "pipe",
    stderr: "inherit",
  });
  const lines = forEachLine(proc.stdout);
  const seen: string[] = [];
  let pendingLine: ReturnType<typeof lines.next> | undefined;
  return {
    save(newContents: string) {
      contents = newContents;
      writeFileSync(entry, contents);
    },
    /** The match of `pattern` in the next stdout line that it matches. */
    async next(pattern: RegExp): Promise<RegExpExecArray> {
      let idleSaves = 0;
      while (true) {
        pendingLine ??= lines.next();
        const { promise: idle, resolve: goIdle } = Promise.withResolvers<"idle">();
        const timer = setTimeout(goIdle, resaveAfter, "idle");
        const result = await Promise.race([pendingLine, idle]);
        clearTimeout(timer);
        if (result === "idle") {
          // The watcher can miss a save. Save again, and report stdout instead of a bare test timeout.
          if (++idleSaves > 3) throw new Error(`no line matched ${pattern}; stdout so far:\n${seen.join("\n")}`);
          writeFileSync(entry, contents);
          continue;
        }
        pendingLine = undefined;
        if (result.done) throw new Error(`stdout closed before ${pattern} matched; stdout so far:\n${seen.join("\n")}`);
        seen.push(result.value);
        const match = pattern.exec(result.value);
        if (match) return match;
      }
    },
    async [Symbol.asyncDispose]() {
      proc.kill();
      await proc.exited;
    },
  };
}

test.concurrent(
  "ServerEntryPoint regenerates cleanly across --hot reloads",
  async () => {
    // Each reload calls ServerEntryPoint.generate() again, which now frees the
    // previous `contents` buffer before allocating a fresh one. Drive several
    // reloads and verify bun:main is re-fetched and evaluates correctly each
    // time; under ASAN this catches any use-after-free of the prior buffer.
    const source = (gen: number) => `globalThis.__gen = (globalThis.__gen ?? 0) + 1;\nconsole.log("GEN", ${gen});\n`;
    using dir = tempDir("bun-main-hot", {});
    await using runner = spawnEntry("--hot", String(dir), "entry.mjs", source(0));

    // Reaching GEN 4 proves the wrapper was regenerated and re-read via
    // cloneUTF8 on every reload without faulting on a stale slice.
    const generations: string[] = [];
    for (let gen = 0; gen <= 4; gen++) {
      if (gen > 0) runner.save(source(gen));
      generations.push((await runner.next(new RegExp(`^GEN ${gen}$`)))[0]);
    }
    expect(generations).toEqual(["GEN 0", "GEN 1", "GEN 2", "GEN 3", "GEN 4"]);
  },
  reloadTestTimeout,
);

// The wrapper passes a default export that looks like a `Bun.serve()` config
// to `Bun.serve()`, so the entry has no handle on the server. Each time the
// wrapper serves the default export it prints "Started ... server: <url>".
const started = /^Started .*server: (\S+)$/;

// The entry notes the keys of globalThis before the wrapper's own body runs.
// Its `fetch` handler then reports the keys that were added after that.
const keysAtEntry = `const keysAtEntry = Reflect.ownKeys(globalThis);\n`;
const reportGlobals = (gen: number) => `() => Response.json({
  gen: ${gen},
  addedToGlobalThis: Reflect.ownKeys(globalThis).filter(key => !keysAtEntry.includes(key)).map(String),
})`;
type GlobalsReport = { gen: number; addedToGlobalThis: string[] };

const esmDefaultExport = (gen: number) => `${keysAtEntry}export default { port: 0, fetch: ${reportGlobals(gen)} };\n`;

test.concurrent.each([
  ["an ESM default export", "entry.mjs", esmDefaultExport],
  [
    "a CommonJS module.exports",
    "entry.cjs",
    gen => `${keysAtEntry}module.exports = { port: 0, fetch: ${reportGlobals(gen)} };\n`,
  ],
  [
    "a module namespace with a then() export",
    "entry.mjs",
    gen =>
      `${keysAtEntry}export function then(resolve) { resolve({ default: { port: 0, fetch: ${reportGlobals(gen)} } }); }\n`,
  ],
] as [string, string, (gen: number) => string][])(
  "--hot reloads the server of %s in place and adds nothing to globalThis",
  async (_, filename, source) => {
    using dir = tempDir("bun-main-hot-server", {});
    await using runner = spawnEntry("--hot", String(dir), filename, source(0));

    const generations: (GlobalsReport & { sameUrl: boolean })[] = [];
    let urlAtStart: string | undefined;
    for (let gen = 0; gen <= 2; gen++) {
      if (gen > 0) runner.save(source(gen));
      // A line of the previous generation can still arrive after the save
      // (one save can reach the watcher as two events). Skip those.
      let url: string;
      let report: GlobalsReport;
      do {
        [, url] = await runner.next(started);
        report = await (await fetch(url)).json();
      } while (report.gen !== gen);
      urlAtStart ??= url;
      // Every generation listens on port 0. The URL stays the same only if
      // Bun.serve() took over the server of the previous generation.
      generations.push({ ...report, sameUrl: url === urlAtStart });
    }

    expect(generations).toEqual([
      { gen: 0, addedToGlobalThis: [], sameUrl: true },
      { gen: 1, addedToGlobalThis: [], sameUrl: true },
      { gen: 2, addedToGlobalThis: [], sameUrl: true },
    ]);
  },
  reloadTestTimeout,
);

test.concurrent(
  "--hot does not keep a default export server alive after the entry stops it",
  async () => {
    // The handler of each generation stops its own server. When the next
    // generation evaluates, nothing references the stopped server any more.
    const source = (gen: number) => `
      globalThis.stoppedServers ??= [];
      Bun.gc(true);
      console.log("gen ${gen} sees stopped servers alive: " + globalThis.stoppedServers.filter(ref => ref.deref()).length);
      export default {
        port: 0,
        fetch(request, server) {
          globalThis.stoppedServers.push(new WeakRef(server));
          server.stop().then(() => console.log("gen ${gen} stopped its server"));
          return new Response("ok");
        },
      };
    `;
    using dir = tempDir("bun-main-hot-stop", {});
    await using runner = spawnEntry("--hot", String(dir), "entry.mjs", source(0));

    const stoppedServersAlive: number[] = [];
    for (let gen = 0; gen <= 2; gen++) {
      if (gen > 0) runner.save(source(gen));
      const [, alive] = await runner.next(new RegExp(`^gen ${gen} sees stopped servers alive: (\\d+)$`));
      stoppedServersAlive.push(Number(alive));
      const [, url] = await runner.next(started);
      expect(await (await fetch(url)).text()).toBe("ok");
      await runner.next(new RegExp(`^gen ${gen} stopped its server$`));
    }

    expect(stoppedServersAlive).toEqual([0, 0, 0]);
  },
  reloadTestTimeout,
);

test.concurrent(
  "--watch serves a default export server and adds nothing to globalThis",
  async () => {
    using dir = tempDir("bun-main-watch-server", {});
    await using runner = spawnEntry("--watch", String(dir), "entry.mjs", esmDefaultExport(0));

    const generations: GlobalsReport[] = [];
    for (let gen = 0; gen <= 1; gen++) {
      if (gen > 0) runner.save(esmDefaultExport(gen));
      // A restart closes the server of the previous process, so the request
      // to the URL of an earlier line can fail at any point. Skip those.
      let report: GlobalsReport | undefined;
      do {
        const [, url] = await runner.next(started);
        report = await fetch(url)
          .then(response => response.json())
          .catch(() => undefined);
      } while (report?.gen !== gen);
      generations.push(report);
    }

    expect(generations).toEqual([
      { gen: 0, addedToGlobalThis: [] },
      { gen: 1, addedToGlobalThis: [] },
    ]);
  },
  reloadTestTimeout,
);

// When the entry point has evaluated, Bun looks at its default export for a server to start
// (`export default { fetch }`). `bun:main` is only the import of the entry point: the look is native,
// and every way to start a program reaches it once.
describe("the look for a server in the default export of the entry point", () => {
  type Files = Record<string, string>;

  async function run(files: Files, args: string[], stdin?: string) {
    using dir = tempDir("bun-main-look", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      env: bunEnv,
      cwd: String(dir),
      stdin: stdin === undefined ? "ignore" : new Blob([stdin]),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr: stripAsanWarning(stderr), exitCode };
  }

  // Under --hot and --watch the process does not end by itself: it is ended once it has printed what `isDone` waits for.
  async function runUntil(files: Files, args: string[], isDone: (stdout: string, stderr: string) => boolean) {
    using dir = tempDir("bun-main-look", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const printed = { stdout: "", stderr: "" };
    const read = async (name: "stdout" | "stderr") => {
      const decoder = new TextDecoder();
      for await (const chunk of proc[name]) {
        printed[name] += decoder.decode(chunk, { stream: true });
        if (isDone(printed.stdout, printed.stderr)) proc.kill();
      }
    };
    await Promise.all([read("stdout"), read("stderr"), proc.exited]);
    return { stdout: printed.stdout, stderr: stripAsanWarning(printed.stderr) };
  }

  // Stands in the place of Bun.serve() and listens to nothing. The line that the host prints then shows that it called it.
  const stub = `Bun.serve = options => (console.log("Bun.serve of", options.name), { development: false, protocol: "http", hostname: "stub", port: 1 });\n`;
  const servedBy = (name: string) => `Bun.serve of ${name}\nStarted server: http://stub:1\n`;
  const server = (name: string) => `{ name: ${JSON.stringify(name)}, fetch() {} }`;
  const serves = (name: string) => ({ stdout: servedBy(name), stderr: [], exitCode: 0 });

  // How a Worker of each kind says that its entry point failed, and that it ended.
  const workers = {
    "node:worker_threads": `
      import { Worker } from "node:worker_threads";
      const worker = new Worker(new URL("./entry.mjs", import.meta.url));
      worker.on("error", error => console.log("error:", error.message));
      worker.on("exit", code => console.log("ended:", code));
    `,
    "web": `
      const worker = new Worker(new URL("./entry.mjs", import.meta.url).href);
      worker.addEventListener("error", event => console.log("error:", event.message));
      worker.addEventListener("close", event => console.log("ended:", event.code));
    `,
  };

  describe("every way to start a program starts the server once", () => {
    test.concurrent.each([
      ["an ES module", ["entry.mjs"], { "entry.mjs": stub + `export default ${server("an ES module")};` }],
      ["a CommonJS module", ["entry.cjs"], { "entry.cjs": stub + `module.exports = ${server("a CommonJS module")};` }],
      ["-e", ["-e", stub + `export default ${server("-e")};`], {}],
      [
        "a preload that imports bun:main",
        ["--preload", "./preload.mjs", "entry.mjs"],
        {
          "entry.mjs": stub + `export default ${server("a preload that imports bun:main")};`,
          "preload.mjs": `await import("bun:main");`,
        },
      ],
      [
        "a Module.runMain that a preload replaced",
        ["--preload", "./preload.cjs", "entry.mjs"],
        {
          "entry.mjs": stub + `export default ${server("a Module.runMain that a preload replaced")};`,
          "preload.cjs": `
            const Module = require("node:module");
            const runMain = Module.runMain;
            Module.runMain = function (...args) { return runMain.apply(this, args); };
          `,
        },
      ],
      [
        "an entry point that awaits",
        ["entry.mjs"],
        {
          "entry.mjs":
            stub + `await new Promise(setImmediate);\nexport default ${server("an entry point that awaits")};`,
        },
      ],
      [
        "an entry point whose import awaits",
        ["entry.mjs"],
        {
          "entry.mjs": stub + `import "./awaits.mjs";\nexport default ${server("an entry point whose import awaits")};`,
          "awaits.mjs": `await new Promise(setImmediate);`,
        },
      ],
    ] as [string, string[], Files][])("%s", async (name, args, files) => {
      expect(await run(files, args)).toEqual(serves(name));
    });

    test.concurrent("stdin", async () => {
      expect(await run({}, ["-"], stub + `export default ${server("stdin")};`)).toEqual(serves("stdin"));
    });

    test.concurrent.each([
      ["-p", `module.exports = ${server("-p")}; 42`, "42\n"],
      ["-p of what it awaits", `export default ${server("-p of what it awaits")}; await 42`, "42\n"],
    ])("%s", async (name, source, printed) => {
      expect(await run({}, ["-p", stub + source])).toEqual({
        stdout: servedBy(name) + printed,
        stderr: [],
        exitCode: 0,
      });
    });

    test.concurrent.each(["--hot", "--watch"])("%s", async flag => {
      const isDone = (stdout: string, stderr: string) => stdout.includes("Started ") || stderr.includes("error:");
      expect(
        await runUntil({ "entry.mjs": stub + `export default ${server(flag)};` }, [flag, "entry.mjs"], isDone),
      ).toEqual({
        stdout: servedBy(flag),
        stderr: [],
      });
    });

    describe.each(Object.keys(workers) as (keyof typeof workers)[])("the entry point of a %s Worker", kind => {
      test.concurrent.each([
        ["that ends at once", `export default ${server("a Worker")};`],
        ["that awaits", `await new Promise(setImmediate);\nexport default ${server("a Worker")};`],
      ])("%s", async (_, source) => {
        expect(await run({ "entry.mjs": stub + source, "main.mjs": workers[kind] }, ["main.mjs"])).toEqual({
          stdout: servedBy("a Worker") + "ended: 0\n",
          stderr: [],
          exitCode: 0,
        });
      });
    });

    test.concurrent.each([
      ["bun build --compile", []],
      ["bun build --compile --bytecode", ["--bytecode"]],
    ])("%s", async (name, flags) => {
      using dir = tempDir("bun-main-look-compile", { "entry.cjs": stub + `module.exports = ${server(name)};` });
      const executable = join(String(dir), isWindows ? "entry.exe" : "entry");
      await using build = Bun.spawn({
        cmd: [bunExe(), "build", "--compile", ...flags, "./entry.cjs", "--outfile", executable],
        env: bunEnv,
        cwd: String(dir),
        stdout: "ignore",
        stderr: "pipe",
      });
      const [buildErrors, buildExitCode] = await Promise.all([build.stderr.text(), build.exited]);
      expect({ errors: stripAsanWarning(buildErrors), exitCode: buildExitCode }).toEqual({ errors: [], exitCode: 0 });
      await using proc = Bun.spawn({
        cmd: [executable],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout, stderr: stripAsanWarning(stderr), exitCode }).toEqual(serves(name));
    });
  });

  describe("what the look reads and calls", () => {
    // The program wrote neither the reads of the look nor its call of Bun.serve(): the error says what Bun did.
    async function errorOf(source: string, error: string) {
      using dir = tempDir("bun-main-look", { "entry.mjs": source + `\nconsole.log("ran");\n` });
      await using proc = Bun.spawn({
        cmd: [bunExe(), "entry.mjs"],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const lines = stripAsanWarning(stderr);
      const at = lines.indexOf(error);
      // The note names the entry point by its whole path.
      const named = lines.slice(at, at + 2).map(line => line.replace(/"[^"]*entry\.mjs"$/, '"entry.mjs"'));
      return { stdout, error: named, exitCode };
    }

    test.concurrent.each([
      [
        "Bun.serve()",
        `export default { port: 99999999, fetch() {} };`,
        'RangeError: The value of "options.port" is out of range. It must be >= 0 and <= 65535. Received 99999999',
        "called Bun.serve() with",
      ],
      [
        "a read of the default export",
        `export default { get fetch() { throw new Error("read of fetch"); } };`,
        "error: read of fetch",
        'read "fetch" to look for a server in',
      ],
      [
        "a read of what an exported then hands over",
        `export function then(resolve) { resolve({ get default() { throw new Error("read of default"); } }); }`,
        "error: read of default",
        'read "default" to look for a server in',
      ],
    ])("an error of %s says what Bun did", async (_, source, error, whatBunDid) => {
      expect(await errorOf(source, error)).toEqual({
        stdout: "ran\n",
        error: [error, `note: Bun ${whatBunDid} the default export of "entry.mjs"`],
        exitCode: 1,
      });
    });

    test.concurrent("an error that the program froze keeps its message", async () => {
      const source = `export default { get fetch() { throw Object.freeze(new Error("read of fetch")); } };`;
      const printed = await errorOf(source, "error: read of fetch");
      expect({ ...printed, error: printed.error.map(line => line.trimStart().split(" ")[0]) }).toEqual({
        stdout: "ran\n",
        error: ["error:", "at"],
        exitCode: 1,
      });
    });

    test.concurrent("a fetch behind a getter is asked once by the look and once by Bun.serve()", async () => {
      const source = `
        export default { port: 0, get fetch() { console.log("get fetch"); return () => new Response("made up"); } };
        setTimeout(() => process.exit(0), 1);
      `;
      const { stdout, stderr, exitCode } = await run({ "entry.mjs": source }, ["entry.mjs"]);
      expect({ stdout: stdout.replace(/^Started .*server: .*$/m, "Started"), stderr, exitCode }).toEqual({
        stdout: "get fetch\nget fetch\nStarted\n",
        stderr: [],
        exitCode: 0,
      });
    });

    test.concurrent("a Proxy around a server is asked for fetch, then for stop", async () => {
      const source = `export default new Proxy(${server("a Proxy")}, { get(target, name, receiver) { if (name !== "name") console.log("get", String(name)); return Reflect.get(target, name, receiver); } });`;
      expect(await run({ "entry.mjs": stub + source }, ["entry.mjs"])).toEqual({
        stdout: "get fetch\nget stop\n" + servedBy("a Proxy"),
        stderr: [],
        exitCode: 0,
      });
    });

    test.concurrent.each([
      [
        "hands over a namespace with a server",
        `console.log(typeof resolve, reject === reportError); resolve({ default: ${server("then")} });`,
        "function true\n" + servedBy("then") + "then returned\n",
      ],
      ["hands over nothing", `resolve();`, "then returned\n"],
    ])("an exported then that %s", async (_, body, stdout) => {
      const source = `export function then(resolve, reject) { ${body} console.log("then returned"); }`;
      expect(await run({ "entry.mjs": stub + source }, ["entry.mjs"])).toEqual({ stdout, stderr: [], exitCode: 0 });
    });
  });

  describe("another module with the key bun:main is not the entry point", () => {
    test.concurrent("a module of node:vm", async () => {
      const source = `
        import vm from "node:vm";
        const module = new vm.SourceTextModule('export default ${server("node:vm")};', { identifier: "bun:main" });
        await module.link(() => {});
        await module.evaluate();
        console.log("evaluated");
        export default ${server("the entry point")};
      `;
      expect(await run({ "entry.mjs": stub + source }, ["entry.mjs"])).toEqual({
        stdout: "evaluated\n" + servedBy("the entry point"),
        stderr: [],
        exitCode: 0,
      });
    });

    // Each copy evaluates the entry point once more. Only the program's own copy is looked at.
    const entry = `
      const copy = globalThis.isCopy || Bun.ModuleGraph.current ? "a copy" : "the entry point";
      console.log("evaluated", copy);
      export default { name: copy, fetch() {} };
    `;

    test.concurrent("bun:main that a preload imports in a ShadowRealm", async () => {
      const preload = `
        const realm = new ShadowRealm();
        realm.evaluate("globalThis.isCopy = true");
        await realm.importValue("bun:main", "default").catch(() => {});
      `;
      expect(
        await run({ "entry.mjs": stub + entry, "preload.mjs": preload }, ["--preload", "./preload.mjs", "entry.mjs"]),
      ).toEqual({
        stdout: "evaluated a copy\nevaluated the entry point\n" + servedBy("the entry point"),
        stderr: [],
        exitCode: 0,
      });
    });

    test.concurrent.each([
      ["while the entry point evaluates", `await new Bun.ModuleGraph().import("bun:main");`],
      [
        "after the look",
        `setImmediate(async () => { await new Bun.ModuleGraph().import("bun:main"); console.log("imported"); });`,
      ],
    ])("bun:main that the entry point imports in a Bun.ModuleGraph %s", async (when, imports) => {
      const source = `${entry}\nif (!Bun.ModuleGraph.current) { ${imports} }`;
      const { stdout, stderr, exitCode } = await run({ "entry.mjs": stub + source }, ["entry.mjs"]);
      expect({ served: stdout.split("\n").filter(line => line.startsWith("Bun.serve of")), stderr, exitCode }).toEqual({
        served: ["Bun.serve of the entry point"],
        stderr: [],
        exitCode: 0,
      });
    });
  });
});
