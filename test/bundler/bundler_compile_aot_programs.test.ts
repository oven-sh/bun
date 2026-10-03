import { describe, expect, test } from "bun:test";
import { cpSync, existsSync, readdirSync, writeFileSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

const programs = join(import.meta.dir, "compile-aot");

const mainOf = (dir: string) => (existsSync(join(dir, "main.ts")) ? "main.ts" : "main.js");

async function run(name: string, env: Record<string, string>) {
  const dir = join(programs, name);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "run", "--aot", mainOf(dir)],
    env: { ...bunEnv, BUN_AOT_VERBOSE: "1", ...env },
    cwd: dir,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const withoutAOTLogLines = (stderr: string) => stderr.replace(/^\[aot\] .*\n/gm, "");

const heavy = new Set(["internals", "short"]);

const reportsErrors = `worker.addEventListener("error", event => {
  console.error("error in the Worker:", event.message);
  process.exitCode = 1;
});`;
const wrappers = {
  "Worker": {
    loads: 1,
    text: `
      const worker = new Worker(new URL("./main.js", import.meta.url).href);
      ${reportsErrors}
    `,
  },
  "two ModuleGraphs in a Worker": {
    loads: 2,
    text: `
      if (Bun.isMainThread) {
        const worker = new Worker(import.meta.url);
        ${reportsErrors}
      } else {
        const url = new URL("./main.js", import.meta.url).href;
        for (let i = 0; i < 2; i++) {
          console.log("graph", i);
          await new Bun.ModuleGraph().import(url).catch(error => console.log("rejected:", String(error)));
          await new Promise(done => setTimeout(done, 10));
        }
      }
    `,
  },
};

async function runWrapped(dir: string, outfile: string, build: Record<string, string>, env: Record<string, string>) {
  await using builder = Bun.spawn({
    cmd: [
      bunExe(),
      "build",
      "--compile",
      "--compile-aot",
      "--splitting",
      "wrapper.ts",
      mainOf(dir),
      ...(existsSync(join(dir, "worker.ts")) ? ["worker.ts"] : []),
      "--outfile",
      outfile,
    ],
    env: { ...bunEnv, ...build },
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect([await builder.stderr.text(), await builder.exited]).toEqual([expect.not.stringContaining("error"), 0]);
  await using proc = Bun.spawn({
    cmd: [join(dir, outfile)],
    env: { ...bunEnv, BUN_AOT_VERBOSE: "1", BUN_DISABLE_SOURCE_CODE_PREVIEW: "1", ...env },
    cwd: dir,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return {
    loadsOfMainFromImage: stderr.split("\n").filter(line => line === "[aot] module: /$bunfs/root/main.js").length,
    stdout,
    stderr: withoutAOTLogLines(stderr).replaceAll(outfile, "<executable>"),
    exitCode,
  };
}

describe("compile.aot", () => {
  for (const name of readdirSync(programs)
    .filter(name => !name.startsWith("."))
    .sort((a, b) => Number(heavy.has(a)) - Number(heavy.has(b)))) {
    const it = heavy.has(name) ? test : test.concurrent;
    const reference = Promise.withResolvers<Awaited<ReturnType<typeof run>>>();
    it(`${name}: reference (no AoT)`, async () => {
      const result = await run(name, {
        BUN_AOT: "0",
        BUN_JSC_useImmutableIntrinsics: "1",
        BUN_JSC_hideFunctionSourceForTesting: "1",
      });
      reference.resolve(result);
      expect(result.stderr).not.toContain("[aot] image: ");
      expect(result.stdout).not.toBe("");
    });

    for (const [label, options, env] of [
      ["AoT", "", {}],
      ["AoT, validated", "validateAOTInferredTypes=1,validateGraphAtEachPhase=1", {}],
      ["AoT, multiple stub copies", "numberOfAOTStubCopiesForTesting=3", {}],
      ["AoT, forced veneers", "forceAOTVeneers=1", {}],
      ["AoT, small function-number limit", "maxAOTFunctionNumberInTypesForTesting=3,validateAOTInferredTypes=1", {}],
      ["AoT, without data stubs", "", { BUN_JSC_useAOTDataStubs: "0" }],
    ] as const) {
      it(`${name}: ${label}`, async () => {
        const [expected, actual] = await Promise.all([
          reference.promise,
          run(name, { ...env, ...(options ? { BUN_AOT_OPTIONS: options } : {}) }),
        ]);
        expect(actual.stderr).toContain("[aot] image: ");
        expect(actual.stderr).not.toContain("[aot] not using");
        expect({ ...actual, stderr: withoutAOTLogLines(actual.stderr) }).toEqual({
          ...expected,
          stderr: withoutAOTLogLines(expected.stderr),
        });
      });
    }

    for (const [context, { loads, text }] of Object.entries(wrappers)) {
      it(`${name}: ${context}`, async () => {
        using dir = tempDir("compile-aot-context", {});
        cpSync(join(programs, name), String(dir), { recursive: true });
        writeFileSync(join(String(dir), "wrapper.ts"), text);
        const [expected, actual] = await Promise.all([
          runWrapped(
            String(dir),
            "reference",
            { BUN_AOT: "0" },
            { BUN_JSC_useImmutableIntrinsics: "1", BUN_JSC_hideFunctionSourceForTesting: "1" },
          ),
          runWrapped(String(dir), "compiled", {}, {}),
        ]);
        const comparable = (result: typeof actual) =>
          loads > 1 ? { ...result, stdout: result.stdout.split("\n").sort().join("\n") } : result;
        expect(comparable(actual)).toEqual({ ...comparable(expected), loadsOfMainFromImage: loads });
        expect(expected.loadsOfMainFromImage).toBe(0);
        expect(expected.stdout).not.toBe("");
      });
    }
  }
});
