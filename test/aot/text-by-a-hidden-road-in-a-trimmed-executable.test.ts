import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { slot, unsupported } from "./run-programs";

const program = `const make = (async function () {}).constructor;
try {
  console.log("answer:", await make(process.argv[2])());
} catch (error) {
  console.log("caught:", error.name, error.code);
}
`;
const notFound = "caught: Error ERR_MODULE_NOT_FOUND";
const texts: [name: string, text: string, whole: string, trimmed: string][] = [
  ["runs as in the whole executable", `return [1, 2].map(x => x * 2).join() + /a+/.test("aa")`, "answer: 2,4true", "answer: 2,4true"],
  ["that makes a generator runs as in the whole executable", `return [...(function* () {}).constructor("yield 1; yield 2")()].join()`, "answer: 1,2", "answer: 1,2"],
  ["that imports a file finds no module", `return (await import("./late.ts")).default`, "answer: late", notFound],
  ["that imports a built-in module that the program holds gets it", `return typeof (await import("node:path")).join`, "answer: function", "answer: function"],
  ["that imports a built-in module that nobody named finds no module", `return typeof (await import("node:zlib")).gzipSync`, "answer: function", notFound],
  ["that imports a native built-in module that nobody named finds no module", `return typeof (await import("node:sqlite")).DatabaseSync`, "answer: function", notFound],
  ["that imports bun:jsc, which nobody named, finds no module", `return typeof (await import("bun:jsc")).heapStats`, "answer: function", notFound],
];

async function run(cmd: string[], cwd: string) {
  await using child = Bun.spawn({ cmd, cwd, env: { ...bunEnv, NO_COLOR: "1" }, stdout: "pipe", stderr: "pipe", timeout: 90_000, killSignal: "SIGKILL" });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  return { stdout, stderr, exitCode };
}

using probe = tempDir("hidden-road-probe", { "hello.ts": "console.log(1);" });
const probed = Bun.spawnSync({ cmd: [bunExe(), "build", "--compile", "--compile-trim-runtime", "hello.ts", "--outfile", "hello"], cwd: String(probe), env: bunEnv, stderr: "pipe" });

(probed.exitCode !== 0 || unsupported || isWindows ? describe.skip : describe)("Function found by a road that the compiler does not see, in a closed world", () => {
  test(
    "text that it evaluates meets what the program holds, and a catchable answer for what it does not",
    () =>
      slot(async () => {
        using dir = tempDir("hidden-road", { "program.mjs": program, "late.ts": `export default "late" as string;\n` });
        const found: Record<string, unknown> = {};
        for (const [kind, flags] of [["whole", []], ["trimmed", ["--compile-trim-runtime"]]] as const) {
          const build = await run([bunExe(), "build", "--compile", "--aot", "--aot-explain=runtime-use", ...flags, "program.mjs", "--outfile", kind], String(dir));
          expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: expect.stringMatching(/^aot: runtime use: closed$/m), exitCode: 0 });
          for (const [name, text] of texts) {
            const ran = await run([join(String(dir), kind), text], String(dir));
            found[`${kind}: text ${name}`] = `${ran.stdout.trim()}, exit ${ran.exitCode}`;
          }
        }
        expect(found).toEqual(Object.fromEntries(texts.flatMap(([name, , whole, trimmed]) => [[`whole: text ${name}`, `${whole}, exit 0`], [`trimmed: text ${name}`, `${trimmed}, exit 0`]])));
      }),
    600_000,
  );
});
