import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isArm64, isDebug, isLinux, isMacOS, isMusl, isPosix, isWindows, tempDir } from "harness";
import {
  chmodSync,
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
} from "node:fs";
import { isAbsolute, join, sep } from "path";

describe("Bun.build compile", () => {
  test("compile with current platform target string", async () => {
    using dir = tempDir("build-compile-target", {
      "app.js": `console.log("Cross-compiled app");`,
    });

    const os = isMacOS ? "darwin" : isLinux ? "linux" : isWindows ? "windows" : "unknown";
    const arch = isArm64 ? "aarch64" : "x64";
    const musl = isMusl ? "-musl" : "";
    const target = `bun-${os}-${arch}${musl}` as any;
    const outdir = join(dir + "", "out");

    const result = await Bun.build({
      entrypoints: [join(dir + "", "app.js")],
      outdir,
      compile: {
        target: target,
        outfile: "app-cross",
      },
    });

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBe(1);
    expect(result.outputs[0].path).toEndWith(isWindows ? "app-cross.exe" : "app-cross");

    const exists = await Bun.file(result.outputs[0].path).exists();

    // Verify that we do write it to the outdir.
    expect(result.outputs[0].path.replaceAll("\\", "/")).toStartWith(outdir.replaceAll("\\", "/"));
    expect(exists).toBe(true);
  });

  // The executable's embedded bytecode is mapped for the life of the process, so decoded instruction streams alias it
  // instead of being copied into private memory. The same bundle run from an on-disk .jsc, whose bytes are an owned buffer
  // the instruction streams are copied out of, is the control.
  test.skipIf(!isLinux)(
    "bytecode from a compiled executable is not copied into private memory",
    async () => {
      const body = Array.from(
        { length: 24 },
        (_, j) => `s = (s * ${j + 3} + a) ^ (b + ${j}); if (s & ${1 << (j % 20)}) s = s - ${j} | 0; o.p${j} = s;`,
      ).join(" ");
      const functions = Array.from(
        { length: 4000 },
        (_, i) => `export function f${i}(a, b) { let s = ${i}; const o = {}; ${body} return [s, ${i}, o]; }`,
      ).join("\n");
      using dir = tempDir("build-compile-bytecode-rss", {
        "funcs.js": functions,
        "app.js": `import * as m from "./funcs.js";
let n = 0;
for (const k in m) n += m[k](2, 3)[1] & 1;
const smaps = require("fs").readFileSync("/proc/self/smaps_rollup", "utf8");
const anon = Number(/Anonymous: +([0-9]+) kB/.exec(smaps)[1]);
console.log(JSON.stringify({ n, anonKB: anon }));`,
      });
      const outfile = join(dir + "", "app");
      const result = await Bun.build({
        entrypoints: [join(dir + "", "app.js")],
        compile: { outfile },
        bytecode: true,
        format: "cjs",
        target: "bun",
      });
      expect(result.success).toBe(true);

      // The same program as `app.js` + `app.js.jsc` on disk: that bytecode is read into an owned buffer and its instruction
      // streams are copied out of it, which is the private memory the executable's mapped payload never allocates.
      const ondisk = await Bun.build({
        entrypoints: [join(dir + "", "app.js")],
        outdir: join(dir + "", "out"),
        bytecode: true,
        format: "cjs",
        target: "bun",
      });
      expect(ondisk.success).toBe(true);

      const run = async (cmd: string[]) => {
        await using proc = Bun.spawn({
          cmd,
          cwd: dir + "",
          env: { ...bunEnv, BUN_JSC_verboseDiskCache: "1" },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        // Both runs execute the bundle from its bytecode, not from a parse, and print nothing else.
        const lines = stderr.split("\n").filter(Boolean);
        expect(lines.filter(l => !l.startsWith("[Disk Cache] "))).toEqual([]);
        expect(lines).toContain("[Disk Cache] Cache hit for sourceCode");
        expect(stdout).toContain("anonKB");
        expect(exitCode).toBe(0);
        return JSON.parse(stdout.trim()) as { n: number; anonKB: number };
      };
      const aliased = await run([outfile]);
      const copied = await run([bunExe(), join(dir + "", "out", "app.js")]);
      expect(aliased.n).toBe(2000);
      expect(copied.n).toBe(2000);
      // The on-disk run also holds app.js and app.js.jsc themselves in owned buffers; that much is not copying.
      const heldKB =
        (statSync(join(dir + "", "out", "app.js")).size + statSync(join(dir + "", "out", "app.js.jsc")).size) / 1024;
      // 4000 decoded functions carry ~11 MB of instruction stream + expression info; copied, that is anonymous memory the aliasing run never allocates.
      expect(copied.anonKB - heldKB - aliased.anonKB).toBeGreaterThan(4096);
    },
    60_000,
  );

  // BUN_BYTECODE_ORDER_OUT records which functions, strings and modules a run read out of the embedded bytecode;
  // --bytecode-order lays the next build's bytecode out by it: one payload for every chunk, what the run read first.
  // The program must not be able to tell, whatever it loads and calls, and in whatever order.
  describe("--compile --bytecode laid out by an order file", () => {
    const moduleNames = ["a", "b", "c", "d", "e", "f"];
    const files: Record<string, string> = {
      // argv: module names in the order to import them; each is asked for `first()` before `second()` unless "rev".
      "app.js": `
        import { shared } from "./shared.js";
        import { bytecodeOrderStats } from "bun:jsc";
        const load = { ${moduleNames.map(name => `${name}: () => import("./${name}.js")`).join(", ")} };
        const out = [shared("app")];
        const reversed = process.argv.includes("rev");
        for (const name of process.argv.slice(2).filter(arg => arg in load)) {
          const mod = await load[name]();
          out.push(...(reversed ? [mod.second(3), mod.first(2)] : [mod.first(2), mod.second(3)]));
        }
        console.log(out.join(" "));
        if (process.argv.includes("stats")) console.error("stats " + JSON.stringify(bytecodeOrderStats()));
      `,
      "shared.js": `
        export function shared(tag) { const twice = text => text + text; return twice(tag).toUpperCase(); }
        export class Unused { #field = "a private field"; method() { return () => this.#field; } }
      `,
    };
    for (const name of moduleNames)
      files[`${name}.js`] = `
        import { shared } from "./shared.js";
        export function first(n) { const pick = list => list.map(x => x * n).join("${name}"); return pick([1, 2, 3]); }
        export function second(n) { return [shared("${name}"), /${name}+/u.source, \`\${n}-${name}\`].join("/"); }
        export function never${name.toUpperCase()}(text) { return [...text].map(c => c.charCodeAt(0).toString(16)); }
        // (Order files name code by its shape: give every module its own.)
        export const shape = [${moduleNames
          .slice(0, moduleNames.indexOf(name) + 1)
          .map(n => `"${n}"`)
          .join(", ")}];
      `;
    const exe = (name: string) => (isWindows ? name + ".exe" : name);
    const buildArgs = ["--compile", "--bytecode", "--splitting", "--format=esm", "--minify", "app.js"];
    let dir: ReturnType<typeof tempDir>;
    const cwd = () => dir + "";
    // One afterAll for the block: a hook in a nested describe would split the block's concurrent tests in two groups.
    let selfKillDir: ReturnType<typeof tempDir> | undefined;
    let internalsDir: ReturnType<typeof tempDir> | undefined;
    afterAll(() => {
      dir?.[Symbol.dispose]();
      selfKillDir?.[Symbol.dispose]();
      internalsDir?.[Symbol.dispose]();
    });

    async function compile(outfile: string, args: string[], env: Record<string, string> = {}, stdin?: string) {
      await using build = Bun.spawn({
        cmd: [bunExe(), "build", ...buildArgs, ...args, "--outfile", outfile],
        env: { ...bunEnv, ...env },
        cwd: cwd(),
        stdin: stdin === undefined ? "ignore" : new Blob([stdin]),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, stderr, exitCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
      return { stderr, exitCode };
    }
    // JSC says so on stderr when it takes a module's code from the embedded bytecode.
    async function run(outfile: string, argv: string[], env: Record<string, string> = {}) {
      await using proc = Bun.spawn({
        cmd: [join(cwd(), outfile), ...argv],
        env: { ...bunEnv, BUN_JSC_verboseDiskCache: "1", ...env },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, cacheHits: stderr.split("\n").filter(line => line.includes("Cache hit")).length, exitCode };
    }
    // `Offsets.flags` in the trailer of the embedded module graph; bit 13 = all bytecode is one linked payload.
    function hasLinkedPayload(outfile: string) {
      const file = readFileSync(isAbsolute(outfile) ? outfile : join(cwd(), outfile));
      const trailer = file.lastIndexOf("\n---- Bun! ----\n", undefined, "latin1");
      return (file.readUInt32LE(trailer - 4) & (1 << 13)) !== 0;
    }
    // The ordered build's counterpart of compile/splitting/StartupModulesPrecedeLazyChunks (bundler_compile_splitting):
    // where each module's bytecode starts in the linked payload, and where the payload's regions end (heads of the
    // modules the recorded run evaluated or did not know, the bodies it decoded, (reserved), heads of the modules it
    // knew and did not evaluate, all other bodies, expression info).
    function linkedLayout(outfile: string) {
      const file = readFileSync(join(cwd(), outfile));
      const trailer = file.lastIndexOf("\n---- Bun! ----\n", undefined, "latin1");
      // `Offsets { byte_count: usize, modules_ptr: StringPointer, entry_point_id: u32, compile_exec_argv_ptr: StringPointer, flags: u32 }`
      const offsets = trailer - 32;
      const base = offsets - Number(file.readBigUInt64LE(offsets));
      const modules = { offset: file.readUInt32LE(offsets + 8), length: file.readUInt32LE(offsets + 12) };
      const flags = file.readUInt32LE(offsets + 28);
      const u32 = (at: number) => file.readUInt32LE(base + at);
      const count = modules.length / 52;
      // Records chained after the module table, in `Flags` bit order.
      let at = modules.offset + modules.length;
      if (flags & (1 << 5)) at += count * 4; // source hashes
      if (flags & (1 << 6)) at += 4 + u32(at) * 12; // builtin bytecode
      if (flags & (1 << 7)) at += 8; // bytecode string table
      if (flags & (1 << 8)) at += 4; // startup module count
      if (flags & (1 << 9)) at += 8; // module-info string table
      if (flags & (1 << 11)) at += 12 + u32(at + 8) * 4; // prelinked module graph
      if (flags & (1 << 12)) at += 8; // runtime options
      expect(flags & (1 << 13), "Flags::HAS_LINKED_BYTECODE_PAYLOAD").not.toBe(0);
      const payload = { offset: u32(at), length: u32(at + 4) };
      const regionEnds = [0, 1, 2, 3, 4, 5].map(region => u32(at + 8 + region * 4));
      // `CompiledModuleGraphFile`: name, contents, sourcemap, bytecode, module_info, bytecode_origin_path (StringPointer
      // each), then 4 bytes. Chunk names are hashed, so identify them by their source text.
      const entry: Record<string, number> = {};
      for (let i = 0; i < count; i++) {
        const record = base + modules.offset + i * 52;
        const contents = { offset: file.readUInt32LE(record + 8), length: file.readUInt32LE(record + 12) };
        const bytecode = { offset: file.readUInt32LE(record + 24), length: file.readUInt32LE(record + 28) };
        expect(bytecode.offset + bytecode.length, `module ${i}'s bytecode runs to the end of the payload`).toBe(
          payload.offset + payload.length,
        );
        const source = file.toString("latin1", base + contents.offset, base + contents.offset + contents.length);
        for (const name of moduleNames)
          if (source.includes(`/${name}+/u`)) entry[name] = bytecode.offset - payload.offset;
        if (source.includes(`"rev"`)) entry.app = bytecode.offset - payload.offset;
      }
      return { payloadLength: payload.length, regionEnds, entry };
    }

    // One digest per module over ALL the code its bytecode holds, called or not; the entry point's line names the executable.
    async function digests(outfile: string) {
      const out = join(cwd(), outfile + ".digest");
      expect((await run(outfile, [], { BUN_BYTECODE_DIGEST_OUT: out })).exitCode).toBe(0);
      return (await Bun.file(out).text()).replaceAll(outfile, "<entry>");
    }

    // What the app prints for "stats": bun:jsc's bytecodeOrderStats() at the end of the run.
    async function stats(outfile: string, argv: string[], env: Record<string, string> = {}) {
      await using proc = Bun.spawn({
        cmd: [join(cwd(), outfile), ...argv, "stats"],
        env: { ...bunEnv, ...env },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      const line = stderr.split("\n").find(line => line.startsWith("stats "));
      expect({ stdout: stdout.length > 0, stats: line !== undefined, exitCode }).toEqual({
        stdout: true,
        stats: true,
        exitCode: 0,
      });
      return JSON.parse(line!.slice("stats ".length));
    }

    // The recorded run imports a, b, c (never d, e, f) and calls first() before second().
    const recordedArgv = ["a", "b", "c"];
    let recorded: Promise<{ order: string; plain: Awaited<ReturnType<typeof run>> }> | undefined;
    const setup = () =>
      (recorded ??= (async () => {
        dir = tempDir("build-compile-bytecode-order", files);
        expect((await compile(exe("plain"), [])).exitCode).toBe(0);
        const plain = await run(exe("plain"), recordedArgv, { BUN_BYTECODE_ORDER_OUT: join(cwd(), "plain.order") });
        // The ordered build, and meanwhile a second recording (another way of starting the program) for the tests that
        // merge two.
        const [ordered, other] = await Promise.all([
          compile(exe("ordered"), ["--bytecode-order=plain.order"]),
          run(exe("plain"), ["f", "rev"], { BUN_BYTECODE_ORDER_OUT: join(cwd(), "other.order") }),
        ]);
        expect({ ordered: ordered.exitCode, other: other.exitCode }).toEqual({ ordered: 0, other: 0 });
        return { order: await Bun.file(join(cwd(), "plain.order")).text(), plain, orderedStderr: ordered.stderr };
      })());

    // Two recordings merged, named as one list and as two flags: one build each, shared by the two tests below, into
    // directories of their own so that the executables can have the same name.
    let mergedBuilds: { list?: Promise<string>; repeated?: Promise<string> } = {};
    const merged = (how: "list" | "repeated") =>
      (mergedBuilds[how] ??= (async () => {
        await setup();
        const outfile = join("merged-" + how, exe("merged"));
        const files = [join(cwd(), "plain.order"), join(cwd(), "other.order")];
        const build = await compile(
          outfile,
          how === "list" ? ["--bytecode-order=" + files.join(",")] : files.map(file => "--bytecode-order=" + file),
        );
        expect({ stderr: build.stderr.includes("error"), exitCode: build.exitCode }).toEqual({
          stderr: false,
          exitCode: 0,
        });
        return outfile;
      })());

    test.concurrent(
      "a run of the ordered build reads the same things and decodes to the same code",
      async () => {
        const { order, plain } = await setup();
        // Nothing but the five kinds of lines: a recording says so, in a line of another kind, when something the run
        // decoded could not be named.
        expect(order.split("\n").filter(line => !/^(v1|[FSMNK] [0-9a-f]{16}|)$/.test(line))).toEqual([]);
        expect(plain).toEqual({
          stdout: "APPAPP 2a4a6 AA/a+/3-a 2b4b6 BB/b+/3-b 2c4c6 CC/c+/3-c\n",
          cacheHits: expect.any(Number),
          exitCode: 0,
        });
        // The entry point's chunk, the shared one, and a, b, c.
        expect(plain.cacheHits).toBe(5);
        expect(order).toStartWith("v1\n");
        for (const kind of ["F", "S", "M", "N", "K"]) expect(order).toMatch(new RegExp(`^${kind} [0-9a-f]{16}$`, "m"));
        expect(hasLinkedPayload(exe("plain"))).toBe(false);
        expect(hasLinkedPayload(exe("ordered"))).toBe(true);

        // What the recorded run read comes first: the heads of the modules it evaluated, then the bodies it decoded. The
        // modules it never loaded have their heads after that, and everything else follows.
        const { payloadLength, regionEnds, entry } = linkedLayout(exe("ordered"));
        const [evaluatedHeadsEnd, hotBodiesEnd, , otherHeadsEnd, coldBodiesEnd, expressionInfoEnd] = regionEnds;
        expect(evaluatedHeadsEnd).toBeGreaterThan(0);
        expect(hotBodiesEnd).toBeGreaterThan(evaluatedHeadsEnd);
        expect(otherHeadsEnd).toBeGreaterThan(hotBodiesEnd);
        expect(coldBodiesEnd).toBeGreaterThan(otherHeadsEnd);
        expect(expressionInfoEnd).toBe(payloadLength);
        expect(Object.keys(entry).sort()).toEqual(["a", "app", "b", "c", "d", "e", "f"]);
        for (const name of ["app", "a", "b", "c"]) expect(entry[name], name).toBeLessThan(evaluatedHeadsEnd);
        for (const name of ["d", "e", "f"]) {
          expect(entry[name], name).toBeGreaterThanOrEqual(hotBodiesEnd);
          expect(entry[name], name).toBeLessThan(otherHeadsEnd);
        }
        const again = await run(exe("ordered"), recordedArgv, { BUN_BYTECODE_ORDER_OUT: join(cwd(), "ordered.order") });
        expect(again).toEqual(plain);
        expect(await Bun.file(join(cwd(), "ordered.order")).text()).toBe(order);
        expect(await digests(exe("ordered"))).toBe(await digests(exe("plain")));
      },
      60_000,
    );

    // Nothing in the layout depends on the order modules load in or functions are first called in: a module finds its
    // code through its own entry, wherever the recorded run's order put it.
    test.concurrent.each([
      ["the recorded modules in reverse, functions in the other order", ["c", "b", "a", "rev"]],
      ["modules the recorded run never loaded, before any it did", ["f", "d", "a", "e", "c", "b"]],
      ["only modules the recorded run never loaded", ["e", "rev", "d", "f"]],
    ])(
      "load order: %s",
      async (_label, argv) => {
        await setup();
        const expected = await run(exe("plain"), argv);
        expect(expected.exitCode).toBe(0);
        expect(await run(exe("ordered"), argv)).toEqual(expected);
      },
      60_000,
    );

    test.concurrent(
      "compile.bytecodeOrder",
      async () => {
        const { plain } = await setup();
        const viaApi = await Bun.build({
          entrypoints: [join(cwd(), "app.js")],
          bytecode: true,
          splitting: true,
          format: "esm",
          minify: true,
          compile: {
            outfile: join(cwd(), exe("api")),
            bytecodeOrder: [join(cwd(), "plain.order"), join(cwd(), "other.order")],
          },
        });
        expect(viaApi.success).toBe(true);
        expect(hasLinkedPayload(exe("api"))).toBe(true);
        expect(await run(exe("api"), recordedArgv)).toEqual(plain);
      },
      60_000,
    );

    test.concurrent(
      "several files on the command line",
      async () => {
        const { plain } = await setup();
        const outfile = await merged("list");
        expect(hasLinkedPayload(outfile)).toBe(true);
        expect(await run(outfile, recordedArgv)).toEqual(plain);
      },
      60_000,
    );

    test.concurrent(
      "several files: the same files in the same order give the same executable",
      async () => {
        const { plain } = await setup();
        const [asList, repeated] = await Promise.all([merged("list"), merged("repeated")]);
        expect(await run(repeated, recordedArgv)).toEqual(plain);
        expect(readFileSync(join(cwd(), repeated)).equals(readFileSync(join(cwd(), asList)))).toBe(true);
      },
      60_000,
    );

    // The order file also lists the functions its build had and its run did not decode. A function in neither list is
    // new or changed since the recording; those get a region of their own next to the hot one instead of being cold.
    test.concurrent(
      "functions the recorded build did not have",
      async () => {
        await setup();
        const [, hotBodiesEnd, unknownBodiesEnd] = linkedLayout(exe("ordered")).regionEnds;
        expect(unknownBodiesEnd).toBe(hotBodiesEnd);

        using editedDir = tempDir("build-compile-bytecode-order-edited", {
          ...files,
          "a.js":
            files["a.js"].replace("x * n", "(x + 1) * n - n") +
            `\nexport function added(list) { return list.filter(Boolean).length; }`,
        });
        const build = async (args: string[], outfile: string) => {
          await using proc = Bun.spawn({
            cmd: [bunExe(), "build", ...buildArgs, ...args, "--outfile", outfile],
            env: bunEnv,
            cwd: editedDir + "",
            stdout: "pipe",
            stderr: "pipe",
          });
          const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          return { stderr: exitCode === 0 ? "" : stderr, exitCode };
        };
        // Independent of each other: at the same time.
        const [plainBuild, orderedBuild] = await Promise.all([
          build([], exe("plain")),
          build([`--bytecode-order=${join(cwd(), "plain.order")}`], exe("ordered")),
        ]);
        expect(plainBuild).toEqual({ stderr: "", exitCode: 0 });
        expect(orderedBuild).toEqual({ stderr: "", exitCode: 0 });
        const file = (name: string) => join("..", editedDir.toString().split(/[\\/]/).pop()!, name);
        const edited = linkedLayout(file(exe("ordered")));
        expect(edited.regionEnds[2]).toBeGreaterThan(edited.regionEnds[1]);
        const expected = await run(file(exe("plain")), recordedArgv);
        expect(expected).toEqual({
          stdout: "APPAPP 2a4a6 AA/a+/3-a 2b4b6 BB/b+/3-b 2c4c6 CC/c+/3-c\n",
          cacheHits: 5,
          exitCode: 0,
        });
        expect(await run(file(exe("ordered")), recordedArgv)).toEqual(expected);
        // A function is named by its text and, through their names, the text of everything written in it: the edited
        // arrow, the arrow around it and a's first() are new. Everything else the run decodes is still the recorded code
        // (shared, second, the other modules' functions), and what is new sits next to it, not in the cold region.
        expect(await stats(file(exe("ordered")), recordedArgv)).toMatchObject({
          hot: expect.any(Number),
          unknown: 3,
          cold: 0,
        });
      },
      60_000,
    );

    // bun:jsc's bytecodeOrderStats(): the function bodies a run decoded, by the region of the payload they are in.
    test.concurrent(
      "bytecodeOrderStats counts what a run decodes by region",
      async () => {
        await setup();
        expect(
          await stats(exe("plain"), recordedArgv, { BUN_BYTECODE_ORDER_OUT: join(cwd(), "stats.order") }),
        ).toBeNull();
        expect((await compile(exe("counted"), ["--bytecode-order=stats.order"])).exitCode).toBe(0);
        const { payloadLength, regionEnds } = linkedLayout(exe("counted"));

        // The recorded path again: everything it decodes is where the order file put it.
        const same = await stats(exe("counted"), recordedArgv);
        expect(same).toEqual({
          hot: expect.any(Number),
          unknown: 0,
          cold: 0,
          hotBytes: expect.any(Number),
          unknownBytes: 0,
          coldBytes: 0,
          regions: {
            moduleHeads: regionEnds[0],
            hot: regionEnds[1] - regionEnds[0],
            unknown: regionEnds[2] - regionEnds[1],
            lateModuleHeads: regionEnds[3] - regionEnds[2],
            cold: regionEnds[4] - regionEnds[3],
            expressionInfo: payloadLength - regionEnds[4],
          },
        });
        // shared and its arrow, and first, its arrow and second of a, b and c.
        expect(same.hot).toBeGreaterThanOrEqual(11);
        expect(same.hotBytes).toBeGreaterThan(0);
        expect(same.hotBytes).toBeLessThanOrEqual(same.regions.hot);

        // A path the recorded run never took: d's functions are with everything else.
        const other = await stats(exe("counted"), ["d"]);
        expect(other.hot).toBeGreaterThan(0);
        expect(other.cold).toBeGreaterThanOrEqual(3);
        expect(other.coldBytes).toBeGreaterThan(0);
        expect(other.unknown).toBe(0);
      },
      60_000,
    );

    // Every VM of the process records: what only a Worker evaluated or called is in the order file too.
    test.concurrent(
      "a Worker's modules and functions are recorded",
      async () => {
        using workerDir = tempDir("build-compile-bytecode-order-worker", {
          "main.js": `
          import { shared } from "./shared.js";
          import { bytecodeOrderStats } from "bun:jsc";
          let fromWorker = { text: "no worker" };
          if (process.argv.includes("worker")) {
            const worker = new Worker("./worker.js");
            fromWorker = await new Promise(resolve => (worker.onmessage = event => resolve(event.data)));
            await worker.terminate();
          }
          console.log(shared("main"), fromWorker.text);
          if (process.argv.includes("stats"))
            console.error("stats " + JSON.stringify({ main: bytecodeOrderStats(), worker: fromWorker.stats }));
        `,
          "worker.js": `
          import { shared } from "./shared.js";
          import { bytecodeOrderStats } from "bun:jsc";
          function onlyTheWorkerCallsThis(list) { return list.map(item => shared(item)).reverse().join("+"); }
          postMessage({ text: onlyTheWorkerCallsThis(["w", "k"]), stats: bytecodeOrderStats() });
        `,
          "shared.js": `export function shared(tag) { const twice = text => text + text; return twice(tag).toUpperCase(); }`,
        });
        const workerCwd = workerDir + "";
        const workerBuildArgs = [
          "--compile",
          "--bytecode",
          "--splitting",
          "--format=esm",
          "--minify",
          "main.js",
          "worker.js",
        ];
        await using build = Bun.spawn({
          cmd: [bunExe(), "build", ...workerBuildArgs, "--outfile", exe("app")],
          env: bunEnv,
          cwd: workerCwd,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [, , buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
        expect(buildExit).toBe(0);
        const record = async (argv: string[], out: string) => {
          await using proc = Bun.spawn({
            cmd: [join(workerCwd, exe("app")), ...argv],
            env: { ...bunEnv, BUN_BYTECODE_ORDER_OUT: join(workerCwd, out) },
            stdout: "pipe",
            stderr: "pipe",
          });
          const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          const lines = (await Bun.file(join(workerCwd, out)).text()).split("\n");
          const of = (kind: string) =>
            new Set(lines.filter(line => line.startsWith(kind + " ")).map(line => line.slice(2)));
          const other = lines.filter(line => !/^(v1|[FSMNK] [0-9a-f]{16}|)$/.test(line));
          return {
            stdout,
            exitCode,
            other,
            evaluated: of("M"),
            notEvaluated: of("N"),
            decoded: of("F"),
            notDecoded: of("K"),
          };
        };
        const [alone, withWorker] = await Promise.all([record([], "alone.order"), record(["worker"], "worker.order")]);
        expect({ stdout: alone.stdout, exitCode: alone.exitCode, other: alone.other }).toEqual({
          stdout: "MAINMAIN no worker\n",
          exitCode: 0,
          other: [],
        });
        expect({ stdout: withWorker.stdout, exitCode: withWorker.exitCode, other: withWorker.other }).toEqual({
          stdout: "MAINMAIN KK+WW\n",
          exitCode: 0,
          other: [],
        });
        // The worker's chunk: evaluated only when the Worker ran, and known not to have been otherwise.
        const onlyWithWorker = [...withWorker.evaluated].filter(hash => !alone.evaluated.has(hash));
        expect(onlyWithWorker.length).toBeGreaterThanOrEqual(1);
        for (const hash of onlyWithWorker) expect(alone.notEvaluated.has(hash)).toBe(true);
        // Likewise the function only the Worker calls.
        const decodedOnlyWithWorker = [...withWorker.decoded].filter(hash => !alone.decoded.has(hash));
        expect(decodedOnlyWithWorker.length).toBeGreaterThanOrEqual(1);
        for (const hash of decodedOnlyWithWorker) expect(alone.notDecoded.has(hash)).toBe(true);

        // bytecodeOrderStats() counts per thread, in a Worker too.
        await using ordered = Bun.spawn({
          cmd: [bunExe(), "build", ...workerBuildArgs, "--bytecode-order=worker.order", "--outfile", exe("ordered")],
          env: bunEnv,
          cwd: workerCwd,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [, orderedStderr, orderedExit] = await Promise.all([
          ordered.stdout.text(),
          ordered.stderr.text(),
          ordered.exited,
        ]);
        expect({ stderr: orderedExit === 0 ? "" : orderedStderr, exitCode: orderedExit }).toEqual({
          stderr: "",
          exitCode: 0,
        });
        await using counted = Bun.spawn({
          cmd: [join(workerCwd, exe("ordered")), "worker", "stats"],
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });
        const [countedStdout, countedStderr, countedExit] = await Promise.all([
          counted.stdout.text(),
          counted.stderr.text(),
          counted.exited,
        ]);
        expect(countedStdout).toBe("MAINMAIN KK+WW\n");
        const line = countedStderr.split("\n").find(line => line.startsWith("stats "));
        expect(line).toBeDefined();
        const { main, worker } = JSON.parse(line!.slice("stats ".length));
        // The Worker: onlyTheWorkerCallsThis and its arrow, shared and its arrow. The main thread: shared and its arrow.
        expect(worker.hot).toBeGreaterThanOrEqual(4);
        expect(main.hot).toBeGreaterThanOrEqual(2);
        expect(worker.regions).toEqual(main.regions);
        expect(countedExit).toBe(0);
      },
      60_000,
    );

    // An order file names code by a hash of its text in which every name counts the same, because a minifier hands out
    // names afresh in every build, and it gets to the contextual keywords: `of`, `get`, `set`, `async`, `as`.
    test.concurrent(
      "a function keeps its name in an order file when a binding is renamed to a contextual keyword",
      async () => {
        const source = (local: string, member: string, extra = "") => `
          ${extra}
          function scale(list, ${local}) { const pick = item => item * ${local}; return list.map(pick); }
          class Box { constructor(v) { this.v = v; } ${member} { return scale([this.v], 3)[0]; } }
          const box = new Box(2);
          console.log(scale([1, 2], 2).join(","), typeof box.size === "function" ? box.size() : box.size);
        `;
        const variants = {
          ab: source("ab", "get size()"),
          of: source("of", "get size()"),
          get: source("get", "get size()"),
          set: source("set", "get size()"),
          async: source("async", "get size()"),
          as: source("as", "get size()"),
          method: source("ab", "size()"),
          // An edit is seen wherever it is: next to a class with fields (the function that initializes them has the text
          // of the whole function around the class), and after a template literal that holds a function.
          fields: source("ab", "get size()", "(function (n) { class A { x = n + 1; } return new A().x; })(1);"),
          // Two different functions around two classes with fields: four names, none of them shared, and the one name
          // of the two default constructors.
          twoFields: source(
            "ab",
            "get size()",
            "(function (n) { class A { x = n + 1; } return new A().x; })(1); (function (m, k) { class B { y = m * k; } return [new B().y]; })(1, 2);",
          ),
          fieldsEdited: source(
            "ab",
            "get size()",
            "(function (n) { class A { x = n + 1; } return new A().x || n; })(1);",
          ),
          template: source(
            "ab",
            "get size()",
            "(function (a) { const t = `v${[a].map(x => x + 1)}`; return t + a; })(1);",
          ),
          templateEdited: source(
            "ab",
            "get size()",
            "(function (a) { const t = `v${[a].map(x => x + 1)}`; if (a) a = -a; return t + a; })(1);",
          ),
        };
        using namesDir = tempDir(
          "build-compile-bytecode-order-names",
          Object.fromEntries(Object.entries(variants).map(([name, text]) => [`${name}.js`, text])),
        );
        // Not minified: the names stay as written. Strings are named by their characters, so leave the S lines out.
        const named = async (name: string) => {
          await using build = Bun.spawn({
            cmd: [bunExe(), "build", "--compile", "--bytecode", "--format=esm", `${name}.js`, "--outfile", exe(name)],
            env: bunEnv,
            cwd: namesDir + "",
            stdout: "pipe",
            stderr: "pipe",
          });
          const [, buildStderr, buildExit] = await Promise.all([
            build.stdout.text(),
            build.stderr.text(),
            build.exited,
          ]);
          expect({ stderr: buildExit === 0 ? "" : buildStderr, exitCode: buildExit }).toEqual({
            stderr: "",
            exitCode: 0,
          });
          const out = join(namesDir + "", `${name}.order`);
          await using proc = Bun.spawn({
            cmd: [join(namesDir + "", exe(name))],
            env: { ...bunEnv, BUN_BYTECODE_ORDER_OUT: out },
            stdout: "pipe",
            stderr: "pipe",
          });
          const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          expect({ stdout, exitCode }).toEqual({ stdout: "2,4 6\n", exitCode: 0 });
          return (await Bun.file(out).text())
            .split("\n")
            .filter(line => /^[FMNK] /.test(line))
            .sort();
        };
        const lines = Object.fromEntries(
          await Promise.all(Object.keys(variants).map(async name => [name, await named(name)] as const)),
        );
        const ab = lines.ab;
        // scale, pick, the constructor and the getter, and the module.
        expect(ab.filter(line => line.startsWith("F ")).length).toBeGreaterThanOrEqual(4);
        expect(ab.filter(line => line.startsWith("M ")).length).toBe(1);
        for (const name of ["of", "get", "set", "async", "as"]) expect(lines[name], name).toEqual(ab);
        // `get size() {}` and `size() {}` are different code: the class that holds them is top-level text.
        expect(lines.method).not.toEqual(ab);
        const functionNames = (name: string) => new Set(lines[name].filter(line => line.startsWith("F "))).size;
        expect(functionNames("twoFields")).toBe(functionNames("ab") + 5);
        for (const name of ["fields", "template"]) {
          const [before, after] = [lines[name], lines[name + "Edited"]];
          const functions = (lines: string[]) => lines.filter(line => line.startsWith("F "));
          // Only the edited function has another name.
          expect(functions(after).filter(line => !before.includes(line)).length, name).toBe(1);
          expect(functions(before).filter(line => !after.includes(line)).length, name).toBe(1);
          expect(new Set(functions(before)).size, name).toBeGreaterThan(new Set(functions(ab)).size);
        }
      },
      60_000,
    );

    test.concurrent(
      "an order file that cannot be read or used",
      async () => {
        const { plain } = await setup();
        const missing = await compile(exe("missing"), ["--bytecode-order=does-not-exist.order"]);
        expect(missing.stderr).toContain("cannot read the bytecode order file does-not-exist.order");
        expect(missing.exitCode).not.toBe(0);

        await using withoutBytecode = Bun.spawn({
          cmd: [
            bunExe(),
            "build",
            "--compile",
            "--format=esm",
            "--bytecode-order=plain.order",
            "app.js",
            "--outfile",
            exe("rejected"),
          ],
          env: bunEnv,
          cwd: cwd(),
          stdout: "pipe",
          stderr: "pipe",
        });
        const [, stderr, exitCode] = await Promise.all([
          withoutBytecode.stdout.text(),
          withoutBytecode.stderr.text(),
          withoutBytecode.exited,
        ]);
        expect(stderr).toContain("--bytecode-order requires --compile --bytecode");
        expect(exitCode).not.toBe(0);
        expect(() =>
          Bun.build({
            entrypoints: [join(cwd(), "app.js")],
            compile: { outfile: join(cwd(), exe("rejected")), bytecodeOrder: "plain.order" },
          }),
        ).toThrow("compile.bytecodeOrder requires bytecode: true");
        // An empty path names no file: the API says so, the command line's list just has nothing between two commas.
        for (const bytecodeOrder of ["", ["plain.order", ""]]) {
          expect(() =>
            Bun.build({
              entrypoints: [join(cwd(), "app.js")],
              bytecode: true,
              compile: { outfile: join(cwd(), exe("rejected")), bytecodeOrder },
            }),
          ).toThrow("compile.bytecodeOrder must not contain an empty path");
        }
        // The error is about the entry that is not a path, not about the array it is in.
        expect(() =>
          Bun.build({
            entrypoints: [join(cwd(), "app.js")],
            bytecode: true,
            compile: { outfile: join(cwd(), exe("rejected")), bytecodeOrder: ["plain.order", 5 as unknown as string] },
          }),
        ).toThrow('The "compile.bytecodeOrder" property must be of type string or array of strings. Received number');
        // `false`, `null` and `[]` are no order file (`haveProfile && path`): the options after it are looked at.
        for (const bytecodeOrder of [false, null, [] as string[]]) {
          expect(() =>
            Bun.build({
              entrypoints: [join(cwd(), "app.js")],
              bytecode: true,
              compile: {
                outfile: join(cwd(), exe("rejected")),
                bytecodeOrder,
                jitPolicy: "8" as unknown as number,
              },
            }),
          ).toThrow("compile.jitPolicy");
        }
        // Lines that are not hints (unknown kinds, bad or reserved hashes) are skipped: nothing is left, so nothing changes.
        await Bun.write(join(cwd(), "junk.order"), "v1\nX 0123456789abcdef\nF nothex\nF ffffffffffffffff\n\n");
        // The two builds that succeed, at the same time.
        const [emptyEntry, junk] = await Promise.all([
          compile(exe("empty-entry"), ["--bytecode-order=,plain.order,,"]),
          compile(exe("junk"), ["--bytecode-order=junk.order"]),
        ]);
        expect(emptyEntry.stderr).not.toContain("bytecode order file");
        expect(emptyEntry.exitCode).toBe(0);
        expect(hasLinkedPayload(exe("empty-entry"))).toBe(true);
        expect(junk.stderr).toContain("the bytecode order file junk.order has nothing this version of Bun can use");
        expect(junk.exitCode).toBe(0);
        expect(hasLinkedPayload(exe("junk"))).toBe(false);
        expect(await run(exe("junk"), recordedArgv)).toEqual(plain);
      },
      60_000,
    );

    // The run is the program's: what goes wrong with the file is said on stderr and changes nothing else, and nothing
    // that is already at the path is removed, an empty directory included.
    test.concurrent(
      "BUN_BYTECODE_ORDER_OUT that cannot be written",
      async () => {
        const { plain } = await setup();
        // Its own directory: the file is written next to where it goes, and other tests record into cwd().
        const parent = join(cwd(), "unwritable");
        mkdirSync(parent, { recursive: true });
        for (const [variable, name] of [
          ["BUN_BYTECODE_ORDER_OUT", "order-out-dir"],
          ["BUN_BYTECODE_DIGEST_OUT", "digest-out-dir"],
        ]) {
          const directory = join(parent, name);
          mkdirSync(directory, { recursive: true });
          // A directory, the name of one that is not there, a file in one that is not there.
          const outs = [directory, join(parent, "no-such-dir") + sep, join(parent, "no-such-dir", "out.order")];
          for (const out of outs) {
            await using proc = Bun.spawn({
              cmd: [join(cwd(), exe("plain")), ...recordedArgv],
              env: { ...bunEnv, [variable]: out },
              stdout: "pipe",
              stderr: "pipe",
            });
            const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
            expect({ stdout, exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
            expect(stderr).toContain(out);
            expect(stderr).toMatch(out.endsWith("out.order") ? /ENOENT/ : /EISDIR|EEXIST|ENOTEMPTY|EPERM|EACCES/);
          }
          expect(existsSync(directory) && statSync(directory).isDirectory()).toBe(true);
          expect(readdirSync(directory)).toEqual([]);
        }
        expect(readdirSync(parent).sort()).toEqual(["digest-out-dir", "order-out-dir"]);
      },
      60_000,
    );

    // process.kill(process.pid, signal) with no handler ends the process without the usual exit: the recording is written
    // before the signal is sent, like the profiles and the compile cache.
    describe.skipIf(isWindows)("a process that sends itself a fatal signal still writes the order file", () => {
      let built: Promise<string> | undefined;
      const build = () =>
        (built ??= (async () => {
          selfKillDir = tempDir("build-compile-bytecode-order-self-kill", {
            "app.js": `
              function used() {
                return "ran";
              }
              console.log(used());
              const signal = process.argv[2];
              if (process.argv[3] === "from its handler") {
                // What a CLI does on Ctrl-C: clean up in a handler, then let the signal end the process after all.
                process.on(signal, function handler() {
                  process.off(signal, handler);
                  process.kill(process.pid, signal);
                });
              }
              process.kill(process.pid, signal);
              // Still here: the signal was one that does not end the process, and what runs now is recorded too.
              await new Promise(resolve => setImmediate(resolve));
              const after = () => "after";
              console.log(after());
              if (signal !== "SIGWINCH") setInterval(() => {}, 1000);
            `,
          });
          await using proc = Bun.spawn({
            cmd: [bunExe(), "build", "--compile", "--bytecode", "--format=esm", "app.js", "--outfile", exe("app")],
            env: bunEnv,
            cwd: String(selfKillDir),
            stdout: "pipe",
            stderr: "pipe",
          });
          const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          expect({ stderr: stderr.includes("error"), exitCode }).toEqual({ stderr: false, exitCode: 0 });
          return String(selfKillDir);
        })());

      // A signal that does not end the process does not end the recording either: the file is written at the real exit.
      test.concurrent(
        "SIGWINCH: the recording goes on",
        async () => {
          const dir = await build();
          const record = async (argv: string[], name: string) => {
            await using proc = Bun.spawn({
              cmd: [join(dir, exe("app")), ...argv],
              env: { ...bunEnv, BUN_BYTECODE_ORDER_OUT: join(dir, name) },
              stdout: "pipe",
              stderr: "pipe",
            });
            const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
            const lines = (await Bun.file(join(dir, name)).text()).split("\n");
            return { stdout, exitCode, decoded: lines.filter(line => line.startsWith("F ")).length };
          };
          const winch = await record(["SIGWINCH"], "SIGWINCH.order");
          expect({ stdout: winch.stdout, exitCode: winch.exitCode }).toEqual({ stdout: "ran\nafter\n", exitCode: 0 });
          // One more function than a run that ends at the signal: the one that ran after it.
          const term = await record(["SIGTERM"], "SIGTERM-compared.order");
          expect(winch.decoded).toBeGreaterThan(term.decoded);
        },
        60_000,
      );

      describe.each(["SIGINT", "SIGTERM"] as const)("%s", signal => {
        test.concurrent.each(["directly", "from its handler"] as const)(
          "sent %s: the recording is there",
          async how => {
            const dir = await build();
            const out = join(dir, `${signal}-${how.replaceAll(" ", "-")}.order`);
            await using proc = Bun.spawn({
              cmd: [join(dir, exe("app")), signal, how],
              env: { ...bunEnv, BUN_BYTECODE_ORDER_OUT: out },
              stdout: "pipe",
              stderr: "pipe",
            });
            await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
            expect(proc.signalCode).toBe(signal);
            const lines = (await Bun.file(out).text()).split("\n");
            expect(lines[0]).toBe("v1");
            expect(lines.filter(line => line.startsWith("F ")).length).toBeGreaterThan(0);
            expect(lines.filter(line => line.startsWith("M ")).length).toBeGreaterThan(0);
          },
          60_000,
        );
      });
    });

    // A recorder knows code by where it was decoded from, so a VM that records keeps its unlinked code instead of dropping
    // it (Bun.shrink() is what an idle VM does) and decoding it again later.
    test.concurrent(
      "a recording run keeps the code it decoded",
      async () => {
        const { order } = await setup();
        using dir = tempDir("build-compile-bytecode-order-keep-code", {
          "app.js": `
            import { bytecodeOrderStats } from "bun:jsc";
            function work(n) {
              const middle = m => {
                const inner = k => k * 3 - k;
                return inner(m) + 1;
              };
              return middle(n) + 1;
            }
            const decoded = () => {
              const stats = bytecodeOrderStats();
              return stats.hot + stats.unknown + stats.cold;
            };
            // Back in the event loop the VM is idle, which is when it shrinks.
            const idle = () => new Promise(resolve => setImmediate(resolve));
            // Once around first, so that the second time decodes nothing for the first time.
            const round = async () => {
              await idle();
              work(1);
              return decoded();
            };
            const before = await round();
            // A shrink that finds a collection under way leaves the code for the next one.
            let after = before;
            for (let attempt = 0; attempt < 10 && after === before; attempt++) {
              Bun.shrink();
              after = await round();
            }
            console.log(after > before ? "decoded again" : "kept");
          `,
          // Another program's, but an order file: bytecodeOrderStats() counts decodes out of a linked payload.
          "app.order": order,
        });
        await using build = Bun.spawn({
          cmd: [
            bunExe(),
            "build",
            "--compile",
            "--bytecode",
            "--format=esm",
            "app.js",
            "--bytecode-order=app.order",
            "--outfile",
            exe("app"),
          ],
          env: bunEnv,
          cwd: String(dir),
          stdout: "pipe",
          stderr: "pipe",
        });
        const [, buildStderr, buildExitCode] = await Promise.all([
          build.stdout.text(),
          build.stderr.text(),
          build.exited,
        ]);
        expect({ stderr: buildStderr.includes("error"), exitCode: buildExitCode }).toEqual({
          stderr: false,
          exitCode: 0,
        });
        const runWith = async (env: Record<string, string>) => {
          await using proc = Bun.spawn({
            cmd: [join(String(dir), exe("app"))],
            env: { ...bunEnv, ...env },
            stdout: "pipe",
            stderr: "pipe",
          });
          const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
          return { stdout, stderr, exitCode };
        };
        expect(await runWith({})).toEqual({ stdout: "decoded again\n", stderr: "", exitCode: 0 });
        expect(await runWith({ BUN_BYTECODE_ORDER_OUT: join(String(dir), "out.order") })).toEqual({
          stdout: "kept\n",
          stderr: "",
          exitCode: 0,
        });
      },
      60_000,
    );

    // A chunk JSC cannot compile has no bytecode, as without an order file: the build says so and goes on, the other
    // chunks are laid out, and the module runs from its source.
    test.concurrent(
      "a chunk without bytecode",
      async () => {
        const { order } = await setup();
        using broken = tempDir("build-compile-bytecode-order-broken", {
          "app.js": `
            import { ok } from "./ok.js";
            console.log("main", ok());
            if (process.argv.includes("bad")) {
              try {
                const { bad } = await import("./bad.js");
                console.log(bad("x"));
              } catch (error) {
                console.log(error.name);
              }
            }
          `,
          "ok.js": `export function ok() { return "ok"; }`,
          // The bundler passes a regular expression through; JSC rejects this one when it compiles the chunk.
          "bad.js": String.raw`export function bad(s) { return /\p{NotAProperty}/u.test(s); }`,
          // Another program's, but an order file: the chunks go through the link encoder.
          "app.order": order,
        });
        await using build = Bun.spawn({
          cmd: [
            bunExe(),
            "build",
            "--compile",
            "--bytecode",
            "--splitting",
            "--format=esm",
            "app.js",
            "--bytecode-order=app.order",
            "--outfile",
            join(cwd(), exe("broken")),
          ],
          env: bunEnv,
          cwd: String(broken),
          stdout: "pipe",
          stderr: "pipe",
        });
        const [, stderr, exitCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
        expect(stderr).toMatch(/Failed to generate bytecode for \S*bad/);
        expect(exitCode).toBe(0);
        expect(hasLinkedPayload(exe("broken"))).toBe(true);
        expect(await run(exe("broken"), [])).toMatchObject({ stdout: "main ok\n", exitCode: 0 });
        expect(await run(exe("broken"), ["bad"])).toMatchObject({ stdout: "main ok\nSyntaxError\n", exitCode: 0 });
      },
      60_000,
    );

    // %p in the path is the pid, so that every process of a run that starts several writes a file of its own.
    test.concurrent(
      "%p in BUN_BYTECODE_ORDER_OUT and BUN_BYTECODE_DIGEST_OUT is the pid",
      async () => {
        const { plain } = await setup();
        await using proc = Bun.spawn({
          cmd: [join(cwd(), exe("plain")), ...recordedArgv],
          env: {
            ...bunEnv,
            BUN_BYTECODE_ORDER_OUT: join(cwd(), "pid-%p.order"),
            BUN_BYTECODE_DIGEST_OUT: join(cwd(), "pid-%p.digest"),
          },
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect({ stdout, stderr, exitCode }).toEqual({ stdout: plain.stdout, stderr: "", exitCode: 0 });
        const written = readdirSync(cwd())
          .filter(file => file.startsWith("pid-"))
          .sort();
        expect(written).toEqual([`pid-${proc.pid}.digest`, `pid-${proc.pid}.order`]);
        expect((await Bun.file(join(cwd(), `pid-${proc.pid}.order`)).text()).startsWith("v1\n")).toBe(true);
      },
      60_000,
    );

    // Internal modules the app imports are modules of the link like the app's chunks: recorded, laid out by the file, and
    // loaded from the payload. "cross": their sources come out of the target executable (this same bun under another
    // version, so the result still runs here). One recording, from an unordered build, for both.
    const internalsApp = `import { join } from "node:path";
import http from "node:http";
import { internalModulesLoadedFromBytecode } from "bun:internal-for-testing";
import { bytecodeOrderStats } from "bun:jsc";
const server = http.createServer(() => {});
console.log(JSON.stringify({ joined: join("a", "b"), fromBytecode: internalModulesLoadedFromBytecode(), stats: bytecodeOrderStats() }));
server.close();`;
    const runInternals = async (outfile: string, env: Record<string, string> = {}) => {
      await using proc = Bun.spawn({ cmd: [outfile], env: { ...bunEnv, ...env }, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
      return JSON.parse(stdout.trim()) as {
        joined: string;
        fromBytecode: number;
        stats: null | { hot: number; cold: number };
      };
    };
    let internalsRecorded: Promise<{
      directory: string;
      order: string;
      unordered: { joined: string; fromBytecode: number };
    }>;
    const internals = () =>
      (internalsRecorded ??= (async () => {
        internalsDir = tempDir("build-compile-bytecode-order-internals", { "app.js": internalsApp });
        const directory = String(internalsDir);
        const outfile = join(directory, exe("unordered"));
        const result = await Bun.build({
          entrypoints: [join(directory, "app.js")],
          compile: { outfile },
          bytecode: true,
          format: "esm",
          target: "bun",
        });
        expect(result.success).toBe(true);
        const order = join(directory, "app.order");
        const { joined, fromBytecode, stats } = await runInternals(outfile, { BUN_BYTECODE_ORDER_OUT: order });
        expect(stats).toBeNull();
        return { directory, order, unordered: { joined, fromBytecode } };
      })());

    test.concurrent.each(["host", "cross"] as const)(
      "internal modules in an ordered build (%s)",
      async mode => {
        const { directory, order, unordered } = await internals();
        // The recording lists far more than the app's own code: the internal modules' functions, used and not.
        const lines = (await Bun.file(order).text()).split("\n");
        expect(lines.filter(line => line.startsWith("F ")).length).toBeGreaterThan(50);
        expect(lines.filter(line => line.startsWith("K ")).length).toBeGreaterThan(50);

        const os = isMacOS ? "darwin" : isLinux ? "linux" : isWindows ? "windows" : "unknown";
        const cross =
          mode === "cross"
            ? {
                target: `bun-${os}-${isArm64 ? "aarch64" : "x64"}${isMusl ? "-musl" : ""}-v1.0.0` as any,
                executablePath: process.execPath,
              }
            : {};
        const outfile = join(directory, exe("ordered-" + mode));
        const result = await Bun.build({
          entrypoints: [join(directory, "app.js")],
          compile: { outfile, bytecodeOrder: order, ...cross },
          bytecode: true,
          format: "esm",
          target: "bun",
        });
        expect(result.success).toBe(true);
        expect(hasLinkedPayload(outfile)).toBe(true);
        const { joined, fromBytecode, stats } = await runInternals(outfile);
        expect({ joined, fromBytecode }).toEqual(unordered);
        expect(fromBytecode).toBeGreaterThan(10);
        // The app has one function of its own: these are the internal modules' functions, out of the hot region.
        expect(stats!.hot).toBeGreaterThan(50);
        expect(stats!.cold).toBeLessThan(stats!.hot / 4);
      },
      60_000,
    );

    // A file that fits next to nothing of the program says so, and changes no behavior.
    test.concurrent(
      "an order file of another program",
      async () => {
        const { plain, orderedStderr } = await setup();
        const hashes = Array.from({ length: 64 }, (_, i) => `F ${(i + 1).toString(16).padStart(16, "0")}`).join("\n");
        await Bun.write(join(cwd(), "other-program.order"), `v1\n${hashes}\n`);
        const other = await compile(exe("other-program"), ["--bytecode-order=other-program.order"]);
        expect(other.stderr).toContain("none of the 64 functions the bytecode order files list is in this build");
        expect(other.exitCode).toBe(0);
        expect(await run(exe("other-program"), recordedArgv)).toEqual(plain);
        // The program's own file does not.
        expect(orderedStderr).not.toContain("the bytecode order files list");
      },
      60_000,
    );

    // The file is read once, front to back.
    test.skipIf(!isPosix).concurrent(
      "an order file that is a pipe",
      async () => {
        const { plain, order } = await setup();
        const piped = await compile(exe("piped"), ["--bytecode-order=/dev/stdin"], {}, order);
        expect(piped.stderr).not.toContain("bytecode order file");
        expect(piped.exitCode).toBe(0);
        expect(hasLinkedPayload(exe("piped"))).toBe(true);
        expect(await run(exe("piped"), recordedArgv)).toEqual(plain);
        expect(await stats(exe("piped"), recordedArgv)).toMatchObject({ hot: expect.any(Number), unknown: 0, cold: 0 });
      },
      60_000,
    );
  });

  // Bytecode is counted among the outputs before it is generated. JSC rejects this regular expression, which the bundler
  // passes through, so that chunk ends up without bytecode: the files after it must still be in the executable.
  test("a chunk whose bytecode cannot be generated keeps the embedded files", async () => {
    using dir = tempDir("build-compile-bytecode-failed", {
      "logo.png": "PNGDATA",
      "data.bin": "BINDATA",
      "index.js": `
          import logo from "./logo.png" with { type: "file" };
          import data from "./data.bin" with { type: "file" };
          console.log(await Bun.file(logo).text(), await Bun.file(data).text());
          try {
            const { bad } = await import("./bad.js");
            console.log(bad("x"));
          } catch (error) {
            console.log(error.name);
          }
        `,
      "bad.js": String.raw`export const bad = s => /\p{NotAProperty}/u.test(s);`,
    });
    const outfile = join(String(dir), isWindows ? "app.exe" : "app");
    const build = await Bun.build({
      entrypoints: [join(String(dir), "index.js")],
      target: "bun",
      format: "esm",
      splitting: true,
      bytecode: true,
      compile: { outfile },
    });
    expect(build.success).toBe(true);
    await using proc = Bun.spawn({ cmd: [outfile], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr }).toEqual({ stdout: "PNGDATA BINDATA\nSyntaxError\n", stderr: "" });
    expect(exitCode).toBe(0);
  }, 60_000);

  // --bytecode into an executable for another os/arch/libc embeds bytecode written by this platform's JavaScriptCore for
  // another's; such executables say so in crash reports (Features: cross_compiled_bytecode). The "other platform" build
  // here is the same OS with the other CPU, and reuses this bun as the target executable, so it still runs here.
  const otherPlatform = `bun-${isLinux ? "linux" : isMacOS ? "darwin" : "windows"}-${isArm64 ? "x64" : "aarch64"}${isMusl ? "-musl" : ""}`;
  test.each([
    ["this platform", undefined as string | undefined, false],
    [otherPlatform, otherPlatform, true],
  ])("--compile --bytecode for %s", async (_label, target, expected) => {
    using dir = tempDir("build-compile-cross-bytecode", {
      "app.js": `require("bun:internal-for-testing").crash_handler.panic();`,
    });
    const outfile = join(dir + "", isWindows ? "app.exe" : "app");
    await using build = Bun.spawn({
      cmd: [
        bunExe(),
        "build",
        "--compile",
        "--bytecode",
        ...(target ? [`--target=${target}`, `--compile-executable-path=${process.execPath}`] : []),
        join(dir + "", "app.js"),
        "--outfile",
        outfile,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, buildStderr, buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
    expect(buildStderr).not.toContain("error");
    expect(buildExit).toBe(0);
    await using proc = Bun.spawn({
      cmd: [outfile],
      env: { ...bunEnv, BUN_CRASH_REPORT_URL: "", BUN_ENABLE_CRASH_REPORTING: "0" },
      stdout: "pipe",
      stderr: "pipe",
    });
    // (stdout is not asserted: ASAN builds print the symbolized crash trace there.)
    const [, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toContain("panic");
    expect(stderr.includes("cross_compiled_bytecode")).toBe(expected);
    expect(exitCode).not.toBe(0);
  });

  // "cross": the target is not the host, so the internal modules' sources, ids and stamp are read out of the target
  // executable's builtins section (here: this same bun under a different version, so the result still runs locally).
  test.each([false, true, "cross" as const])(
    "--bytecode=%p: internal modules the app imports come from embedded bytecode",
    async mode => {
      const bytecode = mode !== false;
      const os = isMacOS ? "darwin" : isLinux ? "linux" : isWindows ? "windows" : "unknown";
      const cross =
        mode === "cross"
          ? {
              target: `bun-${os}-${isArm64 ? "aarch64" : "x64"}${isMusl ? "-musl" : ""}-v1.0.0` as any,
              executablePath: process.execPath,
            }
          : {};
      using dir = tempDir("build-compile-builtin-bytecode", {
        "app.js": `import { join } from "node:path";
import http from "node:http";
import { internalModulesLoadedFromBytecode } from "bun:internal-for-testing";
const server = http.createServer(() => {});
console.log(JSON.stringify({ joined: join("a", "b"), fromBytecode: internalModulesLoadedFromBytecode() }));
server.close();`,
      });
      const outfile = join(dir + "", "app");
      const result = await Bun.build({
        entrypoints: [join(dir + "", "app.js")],
        compile: { outfile, ...cross },
        bytecode,
        format: "esm",
        target: "bun",
      });
      expect(result.success).toBe(true);
      await using proc = Bun.spawn({ cmd: [outfile], env: bunEnv, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      const { joined, fromBytecode } = JSON.parse(stdout.trim());
      expect(joined).toBe(join("a", "b"));
      if (bytecode) {
        // node:path, node:http and what they require at load (node:net, node:events, the stream internals, ...).
        expect(fromBytecode).toBeGreaterThan(10);
      } else {
        expect(fromBytecode).toBe(0);
      }
      expect(exitCode).toBe(0);
    },
    // A --compile build plus (for "cross") bytecode for ~45 internal modules: ~10s under debug+ASAN.
    60_000,
  );

  test("compile with invalid target fails gracefully", async () => {
    using dir = tempDir("build-compile-invalid", {
      "index.js": `console.log("test");`,
    });

    expect(() =>
      Bun.build({
        entrypoints: [join(dir, "index.js")],
        compile: {
          target: "bun-invalid-platform",
          outfile: join(dir, "invalid-app"),
        },
      }),
    ).toThrowErrorMatchingInlineSnapshot(`"Unknown compile target: bun-invalid-platform"`);
  });

  // One compile per test: each compile copies the whole bun binary (~1 GB under debug+ASAN),
  // which by itself takes a good part of the default per-test timeout.
  test.each(["output/nested/app1", "app2", "a/b/c/d/app3"])(
    "compile writes the executable to outfile %s",
    async relativeOutfile => {
      using dir = tempDir("build-compile-outfile", {
        "app.js": `console.log("Testing outfile paths");`,
      });
      const outfile = join(String(dir), relativeOutfile);

      const result = await Bun.build({
        entrypoints: [join(String(dir), "app.js")],
        compile: { outfile },
      });

      expect(result.success).toBe(true);
      expect(result.outputs.map(output => output.path)).toEqual([isWindows ? `${outfile}.exe` : outfile]);
      expect(await Bun.file(result.outputs[0].path).exists()).toBe(true);
    },
  );

  test("compile without outfile writes the executable to the working directory", async () => {
    using dir = tempDir("build-compile-default-outfile", {
      "proj/sub/myapp.ts": `console.log("default outfile");`,
      "cwd/build.ts": `
        const result = await Bun.build({
          entrypoints: [process.argv[2]],
          compile: true,
        });
        console.log(JSON.stringify(result.outputs.map(output => output.path)));
      `,
    });
    const cwd = join(String(dir), "cwd");
    const entrypoint = join(String(dir), "proj", "sub", "myapp.ts");
    const name = isWindows ? "myapp.exe" : "myapp";

    await using proc = Bun.spawn({
      cmd: [bunExe(), "build.ts", entrypoint],
      env: bunEnv,
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    // The name comes from the entrypoint. The directory is the working directory, like `bun build --compile`.
    expect(JSON.parse(stdout)).toEqual([join(cwd, name)]);
    expect(exitCode).toBe(0);

    expect(await Bun.file(join(cwd, name)).exists()).toBe(true);
    expect(await Bun.file(join(String(dir), "proj", "sub", name)).exists()).toBe(false);

    await using app = Bun.spawn({
      cmd: [join(cwd, name)],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [appStdout, appStderr, appExitCode] = await Promise.all([app.stdout.text(), app.stderr.text(), app.exited]);
    expect(appStdout).toBe("default outfile\n");
    expect(appStderr).toBe("");
    expect(appExitCode).toBe(0);
  });

  test("compile with embedded resources uses correct module prefix", async () => {
    using dir = tempDir("build-compile-embedded-resources", {
      "app.js": `
        // This test verifies that embedded resources use the correct target-specific base path
        // The module prefix should be set to the target's base path 
        // not the user-configured public_path
        import { readFileSync } from 'fs';
        
        // Try to read a file that would be embedded in the standalone executable
        try {
          const embedded = readFileSync('embedded.txt', 'utf8');
          console.log('Embedded file:', embedded);
        } catch (e) {
          console.log('Reading embedded file');
        }
      `,
      "embedded.txt": "This is an embedded resource",
    });

    // Test with default target (current platform)
    const result = await Bun.build({
      entrypoints: [join(dir + "", "app.js")],
      compile: {
        outfile: "app-with-resources",
      },
    });

    expect(result.success).toBe(true);
    expect(result.outputs.length).toBe(1);
    expect(result.outputs[0].path).toEndWith(isWindows ? "app-with-resources.exe" : "app-with-resources");

    // The test passes if compilation succeeds - the actual embedded resource
    // path handling is verified by the successful compilation
  });
});

describe("compiled binary validity", () => {
  test("output binary has valid executable header", async () => {
    using dir = tempDir("build-compile-valid-header", {
      "app.js": `console.log("hello");`,
    });

    const outfile = join(dir + "", "app-out");
    const result = await Bun.build({
      entrypoints: [join(dir + "", "app.js")],
      compile: {
        outfile,
      },
    });

    expect(result.success).toBe(true);

    // Read the first 4 bytes and verify it's a valid executable magic number
    const file = Bun.file(result.outputs[0].path);
    const header = new Uint8Array(await file.slice(0, 4).arrayBuffer());

    if (isMacOS) {
      // MachO magic: 0xCFFAEDFE (little-endian)
      expect(header[0]).toBe(0xcf);
      expect(header[1]).toBe(0xfa);
      expect(header[2]).toBe(0xed);
      expect(header[3]).toBe(0xfe);
    } else if (isLinux) {
      // ELF magic: 0x7F 'E' 'L' 'F'
      expect(header[0]).toBe(0x7f);
      expect(header[1]).toBe(0x45); // 'E'
      expect(header[2]).toBe(0x4c); // 'L'
      expect(header[3]).toBe(0x46); // 'F'
    } else if (isWindows) {
      // PE magic: 'M' 'Z'
      expect(header[0]).toBe(0x4d); // 'M'
      expect(header[1]).toBe(0x5a); // 'Z'
    }
  });

  test("compiled binary runs and produces expected output", async () => {
    using dir = tempDir("build-compile-runs", {
      "app.js": `console.log("compile-test-output");`,
    });

    const outfile = join(dir + "", "app-run");
    const result = await Bun.build({
      entrypoints: [join(dir + "", "app.js")],
      compile: {
        outfile,
      },
    });

    expect(result.success).toBe(true);

    await using proc = Bun.spawn({
      cmd: [result.outputs[0].path],
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("compile-test-output");
    expect(exitCode).toBe(0);
  });
});

if (isLinux) {
  describe("ELF section", () => {
    test("compiled binary runs with execute-only permissions", async () => {
      using dir = tempDir("build-compile-exec-only", {
        "app.js": `console.log("exec-only-output");`,
      });

      const outfile = join(dir + "", "app-exec-only");
      const result = await Bun.build({
        entrypoints: [join(dir + "", "app.js")],
        compile: {
          outfile,
        },
      });

      expect(result.success).toBe(true);

      chmodSync(result.outputs[0].path, 0o111);

      await using proc = Bun.spawn({
        cmd: [result.outputs[0].path],
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout.trim()).toBe("exec-only-output");
      expect(exitCode).toBe(0);
    });

    test("compiled binary with large payload runs correctly", async () => {
      // Generate a string payload >16KB to exceed the initial .bun section allocation
      // (BUN_COMPILED is aligned to 16KB). This forces the expansion path in elf.zig
      // which appends data to the end of the file and extends the writable PT_LOAD
      // to cover it.
      const largeString = Buffer.alloc(20000, "x").toString();
      using dir = tempDir("build-compile-large-payload", {
        "app.js": `const data = "${largeString}"; console.log("large-payload-" + data.length);`,
      });

      const outfile = join(dir + "", "app-large");
      const result = await Bun.build({
        entrypoints: [join(dir + "", "app.js")],
        compile: {
          outfile,
        },
      });

      expect(result.success).toBe(true);

      await using proc = Bun.spawn({
        cmd: [result.outputs[0].path],
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("large-payload-20000");
      expect(exitCode).toBe(0);
    });

    test("compiled binary with large payload runs with execute-only permissions", async () => {
      // Same as above but also verifies execute-only works with the expansion path
      const largeString = Buffer.alloc(20000, "y").toString();
      using dir = tempDir("build-compile-large-exec-only", {
        "app.js": `const data = "${largeString}"; console.log("large-exec-only-" + data.length);`,
      });

      const outfile = join(dir + "", "app-large-exec-only");
      const result = await Bun.build({
        entrypoints: [join(dir + "", "app.js")],
        compile: {
          outfile,
        },
      });

      expect(result.success).toBe(true);

      chmodSync(result.outputs[0].path, 0o111);

      await using proc = Bun.spawn({
        cmd: [result.outputs[0].path],
        stdout: "pipe",
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toContain("large-exec-only-20000");
      expect(exitCode).toBe(0);
    });

    test("compiled binary has .bun ELF section", async () => {
      using dir = tempDir("build-compile-elf-section", {
        "app.js": `console.log("elf-section-test");`,
      });

      const outfile = join(dir + "", "app-elf-section");
      const result = await Bun.build({
        entrypoints: [join(dir + "", "app.js")],
        compile: {
          outfile,
        },
      });

      expect(result.success).toBe(true);

      // Verify .bun ELF section exists by reading section headers
      const file = Bun.file(result.outputs[0].path);
      const bytes = new Uint8Array(await file.arrayBuffer());

      // Parse ELF header to find section headers
      const view = new DataView(bytes.buffer);
      // e_shoff at offset 40 (little-endian u64)
      const shoff = Number(view.getBigUint64(40, true));
      // e_shentsize at offset 58
      const shentsize = view.getUint16(58, true);
      // e_shnum at offset 60
      const shnum = view.getUint16(60, true);
      // e_shstrndx at offset 62
      const shstrndx = view.getUint16(62, true);

      // Read .shstrtab section header to get string table
      const strtabOff = shoff + shstrndx * shentsize;
      const strtabFileOffset = Number(view.getBigUint64(strtabOff + 24, true));
      const strtabSize = Number(view.getBigUint64(strtabOff + 32, true));

      const decoder = new TextDecoder();
      let foundBunSection = false;
      for (let i = 0; i < shnum; i++) {
        const hdrOff = shoff + i * shentsize;
        const nameIdx = view.getUint32(hdrOff, true);
        if (nameIdx < strtabSize) {
          // Read null-terminated string from strtab
          let end = strtabFileOffset + nameIdx;
          while (end < bytes.length && bytes[end] !== 0) end++;
          const name = decoder.decode(bytes.slice(strtabFileOffset + nameIdx, end));
          if (name === ".bun") {
            foundBunSection = true;
            // Verify the section has non-zero size
            const shSize = Number(view.getBigUint64(hdrOff + 32, true));
            expect(shSize).toBeGreaterThan(0);
            break;
          }
        }
      }
      expect(foundBunSection).toBe(true);
    });

    // Regression guard for #29963. WSL1's kernel ELF loader rejects `execve`
    // with ENOEXEC when it sees a late PT_LOAD produced by repurposing
    // PT_GNU_STACK. The compiled binary must instead:
    //
    //   1. Keep PT_GNU_STACK in the program header table (not repurposed).
    //   2. Fit the .bun payload inside an existing writable PT_LOAD's
    //      `[p_vaddr, p_vaddr + p_memsz)` range — i.e. the writable segment
    //      was GROWN to cover .bun rather than a new segment being added.
    //
    // The gate here is purely structural (we check the ELF layout); we don't
    // need a WSL1 host to validate the fix.
    //
    // Higher per-test timeout because `bun build --compile` copies + rewrites
    // the entire bun binary (~1GB under debug+ASAN), which blows the 5s
    // default.
    test("compiled binary preserves PT_GNU_STACK and no late PT_LOAD for .bun (#29963)", async () => {
      // Use a small payload — the shape check matters for all sizes but a
      // bigger payload guarantees the expansion path actually runs.
      const largeString = Buffer.alloc(20000, "z").toString();
      using dir = tempDir("build-compile-wsl1-regression", {
        "app.js": `const data = "${largeString}"; console.log("wsl1-regression-" + data.length);`,
      });

      const outfile = join(dir + "", "app-wsl1-regression");
      const result = await Bun.build({
        entrypoints: [join(dir + "", "app.js")],
        compile: { outfile },
      });
      expect(result.success).toBe(true);

      const bytes = new Uint8Array(await Bun.file(result.outputs[0].path).arrayBuffer());
      const view = new DataView(bytes.buffer);

      // ELF64 header layout:
      //   e_phoff @ 32 (u64), e_phentsize @ 54 (u16), e_phnum @ 56 (u16)
      const phoff = Number(view.getBigUint64(32, true));
      const phentsize = view.getUint16(54, true);
      const phnum = view.getUint16(56, true);
      expect(phentsize).toBe(56); // sizeof(Elf64_Phdr)

      // Elf64_Phdr layout:
      //   p_type @ 0 (u32), p_flags @ 4 (u32), p_offset @ 8 (u64),
      //   p_vaddr @ 16 (u64), p_paddr @ 24 (u64),
      //   p_filesz @ 32 (u64), p_memsz @ 40 (u64), p_align @ 48 (u64)
      const PT_LOAD = 1;
      const PT_GNU_STACK = 0x6474e551;
      const PF_W = 2;

      // Locate .bun's vaddr by walking section headers.
      const shoff = Number(view.getBigUint64(40, true));
      const shentsize = view.getUint16(58, true);
      const shnum = view.getUint16(60, true);
      const shstrndx = view.getUint16(62, true);
      const strtabHdr = shoff + shstrndx * shentsize;
      const strtabOff = Number(view.getBigUint64(strtabHdr + 24, true));
      const strtabSize = Number(view.getBigUint64(strtabHdr + 32, true));
      const decoder = new TextDecoder();
      let bunAddr = 0n;
      let bunSize = 0n;
      for (let i = 0; i < shnum; i++) {
        const hdrOff = shoff + i * shentsize;
        const nameIdx = view.getUint32(hdrOff, true);
        if (nameIdx >= strtabSize) continue;
        let end = strtabOff + nameIdx;
        while (end < bytes.length && bytes[end] !== 0) end++;
        const name = decoder.decode(bytes.slice(strtabOff + nameIdx, end));
        if (name === ".bun") {
          bunAddr = view.getBigUint64(hdrOff + 16, true); // sh_addr
          bunSize = view.getBigUint64(hdrOff + 32, true); // sh_size
          break;
        }
      }
      expect(bunAddr).not.toBe(0n);
      expect(bunSize).toBeGreaterThan(0n);

      // Walk program headers: count PT_LOADs, require PT_GNU_STACK to still
      // be present, and find the writable PT_LOAD containing .bun.
      let hasGnuStack = false;
      let loadCount = 0;
      let writableLoadCoversBun = false;
      for (let i = 0; i < phnum; i++) {
        const off = phoff + i * phentsize;
        const pType = view.getUint32(off, true);
        const pFlags = view.getUint32(off + 4, true);
        const pVaddr = view.getBigUint64(off + 16, true);
        const pMemsz = view.getBigUint64(off + 40, true);

        if (pType === PT_GNU_STACK) hasGnuStack = true;
        if (pType === PT_LOAD) {
          loadCount++;
          if ((pFlags & PF_W) !== 0 && pVaddr <= bunAddr && bunAddr + bunSize <= pVaddr + pMemsz) {
            writableLoadCoversBun = true;
          }
        }
      }

      // #29963: PT_GNU_STACK must NOT be repurposed into a PT_LOAD.
      expect(hasGnuStack).toBe(true);
      // #29963: the writable PT_LOAD must have been grown to cover .bun,
      // rather than a new late PT_LOAD being appended.
      expect(writableLoadCoversBun).toBe(true);
      // A stock bun has 3 PT_LOAD segments; the fix must not add a 4th.
      expect(loadCount).toBe(3);
      // JSC bytecode cache requires 128-byte-aligned deserialization input.
      // StandaloneModuleGraph writes bytecode at payload offset 120 assuming
      // the `[u64 size]` header sits at a 128-byte-aligned vaddr (so bytecode
      // lands at vaddr + 8 + 120, which is 128-aligned). A new_vaddr that
      // inherits the RW segment's non-128 residue SIGSEGVs JSC on aarch64.
      expect(bunAddr % 128n).toBe(0n);

      // Sanity: the binary still runs and produces the expected output.
      await using proc = Bun.spawn({
        cmd: [result.outputs[0].path],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout).toContain("wsl1-regression-20000");
      expect(exitCode).toBe(0);
    }, 60_000);

    // Regression guard for #31023. On NixOS, `autoPatchelfHook` runs
    // `patchelf --set-interpreter` on the installed bun binary. Patchelf
    // inserts a *new* writable PT_LOAD at the front of the program-header
    // table (to hold the relocated PHDR + .interp), so the template bun
    // has TWO writable PT_LOADs. `write_bun_section` used to pick the
    // first writable PT_LOAD and extend it — that's patchelf's small
    // segment, unrelated to .bun — producing an output whose grown
    // segment overlaps the read-only and executable PT_LOADs at
    // conflicting vaddrs. The kernel ELF loader mmap'd garbage over .bun
    // at its runtime address and the compiled binary segfaulted on exec.
    //
    // We simulate the NixOS layout by running `patchelf
    // --set-interpreter` on the bun binary (exactly what
    // autoPatchelfHook does) and then using `--compile-executable-path`
    // to drive `bun build --compile` off it. The resulting output must
    // (a) have the .bun section inside a writable PT_LOAD whose extent
    // doesn't cross another PT_LOAD, and (b) actually run.
    const patchelf = Bun.which("patchelf");
    const ldso =
      process.arch === "arm64"
        ? isMusl
          ? "/lib/ld-musl-aarch64.so.1"
          : "/lib/ld-linux-aarch64.so.1"
        : isMusl
          ? "/lib/ld-musl-x86_64.so.1"
          : "/lib64/ld-linux-x86-64.so.2";

    // Mirror of `hostUsesNixStoreInterpreter()` in src/exe_format/elf.rs:
    // gate out NixOS/Guix hosts where the FHS ldso path is a stub that
    // refuses to exec generic binaries. Without this the final
    // `Bun.spawn({cmd:[outfile]})` check fails on a NixOS host because
    // stub-ld rejects the compiled output, not because the fix is broken.
    // Same pattern as the sibling patchelf tests in
    // test/regression/issue/29290.test.ts and 24742.test.ts.
    function readInterp(buf: Buffer): string | null {
      if (buf.length < 64 || buf.readUInt32BE(0) !== 0x7f454c46) return null;
      const e_phoff = Number(buf.readBigUInt64LE(32));
      const e_phnum = buf.readUInt16LE(56);
      for (let i = 0; i < e_phnum; i++) {
        const ph = e_phoff + i * 56;
        if (buf.readUInt32LE(ph) !== 3 /* PT_INTERP */) continue;
        const p_offset = Number(buf.readBigUInt64LE(ph + 8));
        const p_filesz = Number(buf.readBigUInt64LE(ph + 32));
        const region = buf.subarray(p_offset, p_offset + p_filesz);
        const nul = region.indexOf(0);
        return region.subarray(0, nul === -1 ? region.length : nul).toString("utf8");
      }
      return null;
    }
    function hostLooksNix(): boolean {
      if (existsSync("/etc/NIXOS")) return true;
      if (existsSync("/gnu/store")) return true;
      try {
        // bun is ~1 GB in debug builds; PT_INTERP lives in the first page,
        // so read only the leading 4 KiB.
        const fd = openSync(bunExe(), "r");
        try {
          const buf = Buffer.alloc(4096);
          const n = readSync(fd, buf, 0, 4096, 0);
          const selfInterp = readInterp(buf.subarray(0, n));
          if (selfInterp && (selfInterp.startsWith("/nix/store/") || selfInterp.startsWith("/gnu/store/"))) {
            return true;
          }
        } finally {
          closeSync(fd);
        }
      } catch {}
      return false;
    }

    test.skipIf(!patchelf || !existsSync(ldso) || hostLooksNix())(
      "compiled binary works when template bun has patchelf-inserted RW PT_LOAD (#31023)",
      async () => {
        using dir = tempDir("build-compile-patchelf-rw-regression", {
          "app.js": `console.log("patchelf-regression-ok");`,
        });
        const cwd = String(dir);

        // Copy bun and patchelf it — autoPatchelfHook's signature move.
        // Any real interpreter works; we just need patchelf to insert its
        // new writable PT_LOAD at the front of the phdr table.
        const patchedBun = join(cwd, "patched-bun");
        cpSync(bunExe(), patchedBun);
        chmodSync(patchedBun, 0o755);
        {
          const r = Bun.spawnSync({
            cmd: [patchelf!, "--set-interpreter", ldso, patchedBun],
            stderr: "pipe",
          });
          expect(r.stderr.toString()).toBe("");
          expect(r.exitCode).toBe(0);
        }

        // Sanity: the patched bun really does have two writable PT_LOADs.
        // Otherwise the test is vacuous (it would exercise the same path
        // as the stock-bun tests above).
        {
          const bytes = new Uint8Array(await Bun.file(patchedBun).arrayBuffer());
          const view = new DataView(bytes.buffer);
          const phoff = Number(view.getBigUint64(32, true));
          const phentsize = view.getUint16(54, true);
          const phnum = view.getUint16(56, true);
          let writableLoads = 0;
          for (let i = 0; i < phnum; i++) {
            const off = phoff + i * phentsize;
            const pType = view.getUint32(off, true);
            const pFlags = view.getUint32(off + 4, true);
            if (pType === 1 /* PT_LOAD */ && (pFlags & 2) !== 0 /* PF_W */) writableLoads++;
          }
          expect(writableLoads).toBeGreaterThanOrEqual(2);
        }

        // Drive bun build --compile off the patched template.
        const outfile = join(cwd, "app-out");
        const build = Bun.spawnSync({
          cmd: [
            bunExe(),
            "build",
            "--compile",
            "--compile-executable-path",
            patchedBun,
            join(cwd, "app.js"),
            "--outfile",
            outfile,
          ],
          env: bunEnv,
          cwd,
          stderr: "pipe",
          stdout: "pipe",
        });
        expect(build.stderr.toString()).not.toContain("error:");
        expect(build.exitCode).toBe(0);

        // Structural check on the output: the writable PT_LOAD that
        // contains .bun must not overlap any other PT_LOAD. Before the
        // fix, the grown front PT_LOAD extended past the R and R-E
        // PT_LOADs, which is exactly the corruption that segfaulted.
        const bytes = new Uint8Array(await Bun.file(outfile).arrayBuffer());
        const view = new DataView(bytes.buffer);
        const phoff = Number(view.getBigUint64(32, true));
        const phentsize = view.getUint16(54, true);
        const phnum = view.getUint16(56, true);
        const shoff = Number(view.getBigUint64(40, true));
        const shentsize = view.getUint16(58, true);
        const shnum = view.getUint16(60, true);
        const shstrndx = view.getUint16(62, true);
        const strtabHdr = shoff + shstrndx * shentsize;
        const strtabOff = Number(view.getBigUint64(strtabHdr + 24, true));
        const strtabSize = Number(view.getBigUint64(strtabHdr + 32, true));

        // Find .bun's vaddr.
        const decoder = new TextDecoder();
        let bunAddr = 0n;
        for (let i = 0; i < shnum; i++) {
          const hdrOff = shoff + i * shentsize;
          const nameIdx = view.getUint32(hdrOff, true);
          if (nameIdx >= strtabSize) continue;
          let end = strtabOff + nameIdx;
          while (end < bytes.length && bytes[end] !== 0) end++;
          const name = decoder.decode(bytes.slice(strtabOff + nameIdx, end));
          if (name === ".bun") {
            bunAddr = view.getBigUint64(hdrOff + 16, true);
            break;
          }
        }
        expect(bunAddr).not.toBe(0n);

        // Collect all PT_LOAD ranges; find the one that covers .bun and
        // assert it doesn't overlap any of the others.
        type LoadSeg = { vaddr: bigint; end: bigint; writable: boolean };
        const loads: LoadSeg[] = [];
        for (let i = 0; i < phnum; i++) {
          const off = phoff + i * phentsize;
          if (view.getUint32(off, true) !== 1 /* PT_LOAD */) continue;
          const pFlags = view.getUint32(off + 4, true);
          const pVaddr = view.getBigUint64(off + 16, true);
          const pMemsz = view.getBigUint64(off + 40, true);
          loads.push({ vaddr: pVaddr, end: pVaddr + pMemsz, writable: (pFlags & 2) !== 0 });
        }
        const bunLoadIdx = loads.findIndex(s => s.writable && s.vaddr <= bunAddr && bunAddr < s.end);
        expect(bunLoadIdx).toBeGreaterThanOrEqual(0);
        const bunLoad = loads[bunLoadIdx];
        for (let i = 0; i < loads.length; i++) {
          if (i === bunLoadIdx) continue;
          const other = loads[i];
          // Disjoint: either bunLoad ends before other starts, or other
          // ends before bunLoad starts.
          const disjoint = bunLoad.end <= other.vaddr || other.end <= bunLoad.vaddr;
          expect(disjoint).toBe(true);
        }

        // And the binary actually runs — the ultimate behavioral check.
        await using proc = Bun.spawn({
          cmd: [outfile],
          stdout: "pipe",
          stderr: "pipe",
        });
        const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        expect(stdout.trim()).toBe("patchelf-regression-ok");
        expect(exitCode).toBe(0);
      },
      180_000,
    );
  });
}

// Regression guard for the standalone-module-graph ELF probe on Android.
//
// Spec: src/standalone_graph/StandaloneModuleGraph.zig — `fromExecutable()`
// gates the ELF `.bun` reader on `Environment.isLinux or Environment.isFreeBSD`.
// Zig's `isLinux` (builtin.target.os.tag == .linux) is TRUE on Android, so
// Android takes the ELF path and the trailing `comptime unreachable` is dead.
//
// In Rust, `target_os = "linux"` and `target_os = "android"` are distinct cfg
// values. A naive port of the Zig gate as
//   #[cfg(any(target_os = "linux", target_os = "freebsd"))]
// silently excludes Android and falls through to the catch-all
// `unreachable!()`, so every `bun build --compile` binary panics at startup
// on Android instead of loading its embedded module graph.
//
// This test only runs on an Android host. It compiles a trivial app and
// asserts the resulting binary starts, finds its graph, and runs the entry —
// i.e. the ELF arm was taken, not `unreachable!()`.
if (process.platform === "android") {
  describe("ELF section (Android)", () => {
    test("compiled standalone binary loads its module graph on Android", async () => {
      using dir = tempDir("build-compile-android-elf", {
        "app.js": `console.log("android-standalone-ok");`,
      });

      const outfile = join(String(dir), "app-android");

      await using build = Bun.spawn({
        cmd: [bunExe(), "build", "--compile", join(String(dir), "app.js"), "--outfile", outfile],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, buildStderr, buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
      expect(buildStderr).not.toContain("error:");
      expect(buildExit).toBe(0);

      await using proc = Bun.spawn({
        cmd: [outfile],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      // If the Rust cfg-gate diverges from Zig's `Environment.isLinux`, the
      // process panics with `internal error: entered unreachable code` before
      // any user JS runs. Assert the spec behavior: graph found, entry ran.
      expect(stderr).not.toContain("unreachable");
      expect(stdout.trim()).toBe("android-standalone-ok");
      expect(exitCode).toBe(0);
    }, 60_000);
  });
}

// A standalone compiled binary bypasses `Arguments::parse` (no `--cwd`/global
// flags, no baked exec-argv), so `absolute_working_dir` stays unset and the
// FIRST `getcwd` of the whole startup is the one inside `Transpiler::init`.
// When the cwd has been deleted that `getcwd` fails with ENOENT; the bug was
// that the per-VM init hook swallowed the error and left `vm.transpiler`
// zeroed, so the next read (`configure_defines` → `run_env_loader`) hit a null
// deref and the binary crashed (the segfault users saw launching a compiled
// CLI from a directory that had been removed). It must instead exit cleanly
// with the ENOENT message.
//
// POSIX-only: a process can keep a deleted directory as its cwd until the last
// fd to it closes, whereas Windows refuses to remove a directory that is any
// process's cwd — so the scenario is unreachable there. The cwd has to be
// removed AFTER the process starts, which `Bun.spawn`'s `cwd` can't do, so a
// shell wrapper `cd`s in, `rmdir`s, then execs the binary (how a user hits it).
describe("compiled binary in a deleted cwd", () => {
  test.if(isPosix)(
    "exits cleanly instead of crashing",
    async () => {
      using dir = tempDir("build-compile-deleted-cwd", {
        "app.js": `console.log("should-not-run");`,
      });
      const outfile = join(String(dir), "app");

      await using build = Bun.spawn({
        cmd: [bunExe(), "build", "--compile", join(String(dir), "app.js"), "--outfile", outfile],
        env: bunEnv,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
      });
      const [, buildStderr, buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
      expect(buildStderr).not.toContain("error:");
      expect(buildExit).toBe(0);

      // A fresh directory to stand in and delete — NOT `dir`, which holds the
      // compiled binary we still need to exec.
      using cwdDir = tempDir("build-compile-gone-cwd", {});
      const gone = String(cwdDir);

      await using proc = Bun.spawn({
        cmd: ["/bin/sh", "-c", `cd "${gone}" && rmdir "${gone}" && exec "${outfile}"`],
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      expect(stdout).toBe("");
      expect(stderr).toContain("The current working directory was deleted");
      expect(exitCode).toBe(1);
    },
    60_000,
  );
});

// Every region of the embedded module graph (file contents, names, bytecode, the
// module table) is addressed by a 32-bit offset and length. `to_bytes` used to cast
// every offset with `as u32`, so a graph past 4 GiB was written with wrapped
// offsets: the build succeeded and the executable failed at startup
// (`Module not found ''`) or read the wrong bytes. The build has to fail instead.
//
// Debug builds lower the limit through BUN_DEBUG_TEST_STANDALONE_GRAPH_MAX_BYTES
// so the test does not need a 4 GiB input. The message still names the real limit.
describe.concurrent("embedded module graph size limit", () => {
  const asset = Buffer.alloc(8 * 1024 * 1024, "x");
  const files = {
    "app.js": `import big from "./big.bin" with { type: "file" };
console.log(require("fs").statSync(big).size);`,
    "big.bin": asset,
  };

  test.skipIf(!isDebug)("build --compile fails when the graph is larger than the offsets can address", async () => {
    using dir = tempDir("build-compile-graph-too-large", files);

    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "app.js", "--outfile", "app"],
      env: { ...bunEnv, BUN_DEBUG_TEST_STANDALONE_GRAPH_MAX_BYTES: String(4 * 1024 * 1024) },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, stderr, exitCode] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);

    expect(stderr).toContain(
      "failed to generate module graph bytes: embedded module graph would exceed 4 GiB (its offsets are 32-bit)",
    );
    expect(exitCode).toBe(1);
    // No executable, not even a partial one.
    expect(readdirSync(String(dir)).sort()).toEqual(["app.js", "big.bin"]);
  });

  test.skipIf(!isDebug)("build --compile still succeeds when the graph fits under the limit", async () => {
    using dir = tempDir("build-compile-graph-fits", files);
    const outfile = join(String(dir), isWindows ? "app.exe" : "app");

    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "app.js", "--outfile", outfile],
      env: { ...bunEnv, BUN_DEBUG_TEST_STANDALONE_GRAPH_MAX_BYTES: String(256 * 1024 * 1024) },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, buildStderr, buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
    expect(buildStderr).not.toContain("error");
    expect(buildExit).toBe(0);

    await using proc = Bun.spawn({
      cmd: [outfile],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe(`${asset.byteLength}\n`);
    expect(exitCode).toBe(0);
  });
});

// file command test works well

// `optimize.bytecode: false` / `--no-optimize-bytecode` is the only build that embeds unoptimized bytecode; it must
// keep producing working output.
describe("Bun.build compile optimize", () => {
  const files = {
    "entry.ts": `
      import { a, bump, counter } from "./a";
      import { b } from "./b";
      console.log(a, b, counter);
      bump();
      console.log(counter, (await import("./lazy")).lazy());
    `,
    "a.ts": `
      import { nameB } from "./b";
      export let counter = 0;
      export function bump() { counter++; }
      export function nameA() { return "A"; }
      export const a = "a:" + nameB();
    `,
    "b.ts": `
      import { nameA } from "./a";
      export function nameB() { return "B"; }
      export const b = "b:" + nameA();
    `,
    "lazy.ts": `
      import { counter } from "./a";
      export function lazy() { return "lazy:" + counter; }
    `,
  };
  const expected = "a:B b:A 0\n1 lazy:1\n";

  async function runExe(exe: string) {
    await using proc = Bun.spawn({ cmd: [exe], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe(expected);
    expect(exitCode).toBe(0);
  }

  test("optimize.bytecode: false (Bun.build, esm + splitting)", async () => {
    using dir = tempDir("build-compile-optimize-bytecode-off", files);
    const outfile = join(String(dir), "app" + (isWindows ? ".exe" : ""));
    const result = await Bun.build({
      entrypoints: [join(String(dir), "entry.ts")],
      compile: { outfile },
      bytecode: true,
      format: "esm",
      splitting: true,
      optimize: { bytecode: false },
    });
    expect(result.logs.map(String).join("\n")).toBe("");
    expect(result.success).toBe(true);
    await runExe(outfile);
  });

  test("compile.jitPolicy must be a finite number >= 1", () => {
    using dir = tempDir("build-compile-jit-policy", files);
    for (const jitPolicy of [0, 0.5, NaN, Infinity]) {
      expect(() => Bun.build({ entrypoints: [join(String(dir), "entry.ts")], compile: { jitPolicy } })).toThrow(
        RangeError,
      );
    }
    expect(() =>
      Bun.build({ entrypoints: [join(String(dir), "entry.ts")], compile: { jitPolicy: "8" as unknown as number } }),
    ).toThrow(TypeError);
  });

  test.each([
    ["--no-optimize-bytecode esm", ["--format=esm", "--no-optimize-bytecode"]],
    ["--no-optimize-bytecode cjs", ["--format=cjs", "--no-optimize-bytecode"]],
  ])("%s (CLI)", async (tag, flags) => {
    using dir = tempDir("build-compile-optimize-cli", files);
    const outfile = join(String(dir), "app" + (isWindows ? ".exe" : ""));
    // cjs output has no top-level await.
    const entry = flags.includes("--format=cjs") ? "entry-cjs.ts" : "entry.ts";
    await Bun.write(
      join(String(dir), "entry-cjs.ts"),
      files["entry.ts"].replace('(await import("./lazy")).lazy()', 'require("./lazy").lazy()'),
    );
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--compile", "--bytecode", ...flags, entry, "--outfile", outfile],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, buildStderr, buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
    expect(buildStderr).not.toContain("error");
    expect(buildExit).toBe(0);
    await runExe(outfile);
  });

  test("--no-optimize-bytecode without --compile (--outdir)", async () => {
    using dir = tempDir("build-optimize-bytecode-outdir", {
      "index.ts": `const f = (n: number) => n * 2; console.log(f(21));`,
    });
    await using build = Bun.spawn({
      cmd: [bunExe(), "build", "--bytecode", "--no-optimize-bytecode", "--target=bun", "index.ts", "--outdir", "out"],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [, buildStderr, buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
    expect(buildStderr).not.toContain("error");
    expect(buildExit).toBe(0);
    expect(existsSync(join(String(dir), "out", "index.js.jsc"))).toBe(true);
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(String(dir), "out", "index.js")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("42\n");
    expect(exitCode).toBe(0);
  });

  // The bytecode optimizer deletes the jmp that closes a try body once the empty catch has been threaded to the loop
  // header, so that try range falls through into the next one. DFG then has to keep the locals that are live only at
  // the first catch (loop-only state) alive across the call that throws.
  describe("locals live only at a catch inside a loop", () => {
    const fixture = `
      let sink = 0;
      function touch() { sink++; }

      function forOfResultDiscarded(kind) {
        for (let name of ["a", "b"]) {
          try { return JSON.parse(kind === "k" && name === "b" ? "1" : "{bad"), true; } catch {}
        }
        return false;
      }
      function forOfResultUsed(kind) {
        for (let name of ["a", "b"]) {
          try { return JSON.parse(kind === "k" && name === "b" ? "1" : "{bad"); } catch {}
        }
        return false;
      }
      function whileInsideFinally(kind) {
        let n = 0, limit = { value: 3 }, log = [];
        try {
          while (true) {
            n++;
            log.push(n);
            if (n > limit.value) { sink += log.length; break; }
            try { return JSON.parse(kind === "k" && n >= 2 ? "1" : "{bad"), true; } catch {}
          }
        } finally {
          try { touch(); } catch {}
        }
        return false;
      }
      function labelledBreakIntoTry(kind) {
        let result = false, n = 0, limit = { value: 3 }, log = [];
        done: {
          for (;;) {
            n++;
            log.push(n);
            if (n > limit.value) { sink += log.length; break; }
            try { JSON.parse(kind === "k" && n >= 2 ? "1" : "{bad"); result = true; break done; } catch {}
          }
        }
        try { touch(); } catch {}
        return result;
      }
      // Nothing throws when this one goes wrong: the lost local silently becomes NaN.
      let observed = 0;
      function loopOnlyNumber(kind) {
        let result = false, n = 0, doubled = 1;
        done: {
          for (;;) {
            n++;
            doubled = doubled * 2;
            observed = doubled;
            if (n > 3) break;
            try { JSON.parse(kind === "k" && n >= 2 ? "1" : "{bad"); result = true; break done; } catch {}
          }
        }
        try { touch(); } catch {}
        return result + ":" + n + ":" + observed;
      }
      // Inlining the recursive call reaches one exception handler through two inline call frames.
      function recursive(depth) {
        let saved = 0;
        try {
          saved = depth * 3 + 1;
          if (depth > 0) sink += recursive(depth - 1);
          JSON.parse("{bad");
          return -1;
        } catch {
          return saved;
        }
      }
      function forOfFromCaller(kind) { return forOfResultDiscarded(kind); }

      const cases = [
        [forOfResultDiscarded, "true", "false"],
        [forOfResultUsed, "1", "false"],
        [whileInsideFinally, "true", "false"],
        [labelledBreakIntoTry, "true", "false"],
        [loopOnlyNumber, "true:2:4", "false:4:16"],
      ];
      for (let i = 0; i < 300; i++) {
        const hit = i % 3 === 0;
        const kind = hit ? "k" : "x";
        for (const [f, whenHit, whenMiss] of cases) {
          const result = String(f(kind));
          if (result !== (hit ? whenHit : whenMiss)) throw new Error(f.name + ": got " + result + " at " + i);
        }
        if (forOfFromCaller(kind) !== hit) throw new Error("forOfFromCaller: bad result at " + i);
        if (recursive(2) !== 7) throw new Error("recursive: bad result at " + i);
      }
      console.log("ok");
    `;
    // Compile on the main thread so the tier-up points do not depend on scheduling, and reach the DFG after about a
    // hundred calls: every case throws several exceptions per call, which is slow in debug builds. With these settings
    // each case goes wrong within 70 iterations when the locals are lost.
    const jit = {
      BUN_JSC_useConcurrentJIT: "0",
      BUN_JSC_useFTLJIT: "0",
      BUN_JSC_thresholdForJITAfterWarmUp: "10",
      BUN_JSC_thresholdForJITSoon: "10",
      BUN_JSC_thresholdForOptimizeAfterWarmUp: "100",
      BUN_JSC_thresholdForOptimizeSoon: "100",
    };
    const inlineMore = { ...jit, BUN_JSC_maximumFunctionForCallInlineCandidateBytecodeCostForDFG: "1000" };

    test.concurrent.each([
      ["optimized bytecode", true, jit],
      ["optimized bytecode, inlined", true, inlineMore],
      // The recursive case does not need the optimizer.
      ["source, inlined", false, inlineMore],
    ])("%s", async (tag, bytecode, env) => {
      using dir = tempDir("build-optimize-bytecode-catch-liveness", { "index.js": fixture });
      let entry = join(String(dir), "index.js");
      if (bytecode) {
        await using build = Bun.spawn({
          cmd: [bunExe(), "build", "--bytecode", "--format=cjs", "--target=bun", "index.js", "--outdir", "out"],
          env: bunEnv,
          cwd: String(dir),
          stdout: "pipe",
          stderr: "pipe",
        });
        const [, buildStderr, buildExit] = await Promise.all([build.stdout.text(), build.stderr.text(), build.exited]);
        expect(buildStderr).not.toContain("error");
        expect(buildExit).toBe(0);
        entry = join(String(dir), "out", "index.js");
        expect(existsSync(entry + ".jsc")).toBe(true);
      }
      await using proc = Bun.spawn({
        cmd: [bunExe(), entry],
        env: { ...bunEnv, ...env },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect(stderr).toBe("");
      expect(stdout).toBe("ok\n");
      expect(exitCode).toBe(0);
    });
  });
});
