import { cc, ptr } from "bun:ffi";
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, tempDir } from "harness";
import { join } from "node:path";
import { built, spawned } from "./harness/commands";
import { compileCommand } from "./harness/flags";
import { test } from "./supported";

// `console.log(1)` asked each of the hundred classes that Bun adds to JavaScript whether the realm had made it yet, three times, each through a function of its own.
// A loop over a table of functions shows without any symbol: one call instruction that calls many different functions.

function compileTracer() {
  return cc({
    source: join(import.meta.dir, "calls-of-a-start.c"),
    symbols: {
      canTrace: { args: [], returns: "int" },
      countCallsOfStart: { args: ["cstring", "ptr"], returns: "int" },
    },
  }).symbols;
}

function findTracer(): ReturnType<typeof compileTracer> | string {
  if (!isLinux || process.arch !== "x64") return "it reads the registers of Linux on x64";
  if (isDebug || isASAN) return "a debug or ASAN build runs a hundred times the instructions, one at a time";
  try {
    const tracer = compileTracer();
    return tracer.canTrace() ? tracer : "ptrace is refused here";
  } catch (error) {
    return `bun:ffi compiles no C here: ${error}`;
  }
}

const tracer = findTracer();
if (typeof tracer === "string") console.error(`SKIPPED: ${import.meta.file}: ${tracer}`);

function countCalls(executable: string) {
  if (typeof tracer === "string") throw new Error(tracer);
  const counts = new BigUint64Array(3);
  expect(tracer.countCallsOfStart(Buffer.from(executable + "\0"), ptr(counts))).toBe(0);
  const [instructions, functions, functionsOfWidestCall] = Array.from(counts, Number);
  return { instructions, functions, functionsOfWidestCall };
}

test.skipIf(typeof tracer === "string")(
  "no call of the start has more targets than in a plain executable, and fewer functions of Bun are entered",
  async () => {
    using folder = tempDir("calls-of-a-start", { "main.js": "console.log(1);\n" });
    const build = async (command: readonly string[], name: string) => {
      built(await spawned([bunExe(), ...command, "main.js", "--outfile", name], String(folder), bunEnv));
      return join(String(folder), name);
    };
    const compiled = countCalls(await build(compileCommand, "compiled"));
    const plain = countCalls(await build(["build", "--compile"], "plain"));
    console.error(`compiled ${JSON.stringify(compiled)}\nplain ${JSON.stringify(plain)}`);

    // Else the tracer did not find Bun's code in one of them.
    expect(Math.min(compiled.functionsOfWidestCall, plain.functionsOfWidestCall)).toBeGreaterThan(1);
    expect(compiled.functionsOfWidestCall).toBeLessThanOrEqual(2 * plain.functionsOfWidestCall);
    expect(compiled.functions).toBeLessThan(plain.functions);
    expect(compiled.instructions).toBeLessThan(plain.instructions);
  },
  600_000,
);
