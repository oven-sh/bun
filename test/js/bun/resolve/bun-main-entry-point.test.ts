import { expect, test } from "bun:test";
import { bunEnv, bunExe, forEachLine, isASAN, isDebug, tempDir } from "harness";
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
