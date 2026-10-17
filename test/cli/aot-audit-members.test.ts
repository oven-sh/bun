import { describe, expect, test } from "bun:test";
import { unsupported } from "../aot/run-programs";
import { readFileSync } from "fs";
import { bunEnv, bunExe, isArm64, isLinux, isMacOS, tempDir } from "harness";
import { join } from "path";

// ONE RULE, WRITTEN TWICE. What becomes of an object that typed code has not made, where it enters a record type that admits no
// strangers, is decided by the engine in an --aot executable (class Coercion in JavaScriptCore/aot/AOTTypedObject.cpp) and foretold by
// `bun --aot-audit` (canBeAllocated(), matchesShape() in src/runtime/cli/aot_audit.js, over the tables of src/aot/audit.rs). This test holds the
// two to each other: every case of the fixtures runs plain, in an executable and under the audit.
//   FALSE: the audit says would-throw and the executable does not throw. Never.
//   MISSED: the executable throws because the object does not fit, and the audit has no record on that line. Only where the case says
//   `// silent: why`.
// A case that is silent and named all the same fails too: the comment is then out of date.
// Data that fits and is refused for its identity ("the object matches T, but it cannot be converted in place") is not the audit's to
// foretell: that goes by sizes which only the compiler's placement knows.
const compiles = !unsupported;
const tsconfig = JSON.stringify({
  compilerOptions: { strict: true, module: "esnext", moduleResolution: "bundler", target: "esnext", types: [], lib: ["esnext", "dom"] },
});

async function spawned(cmd: string[], cwd: string, env: Record<string, string> = {}) {
  await using proc = Bun.spawn({ cmd, cwd, env: { ...bunEnv, NO_COLOR: "1", ...env }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

function answers(stdout: string) {
  const found = new Map<number, string>();
  for (const line of stdout.split("\n")) {
    const match = /^(\d+) (.*)$/.exec(line);
    if (match) found.set(Number(match[1]), match[2]);
  }
  return found;
}

describe.concurrent.skipIf(!compiles)("the audit and the executable hold an outside object to the same members", () => {
  test.each([
    ["shapes", 65, 3],
    ["open", 109, 0],
    ["objects", 76, 3],
    ["members", 70, 0],
    ["kinds", 34, 0],
    ["roads", 128, 13],
    ["reads", 60, 17],
    ["twice", 8, 0],
    ["stored", 17, 0],
    ["rings", 11, 0],
    ["shorthand", 21, 11],
    ["classes", 69, 30],
    ["calls", 14, 13],
    ["served", 11, 4],
    ["attributes", 33, 9],
    ["absent", 21, 6],
    ["unmarked", 20, 11],
    ["siblings", 4, 0],
  ] as const)(
    "%s",
    async (name, numberOfCases, namedAtLeast) => {
      const text = readFileSync(join(import.meta.dir, "aot-audit-members", name + ".ts"), "utf8");
      const lines = text.split("\n");
      const lineOfFirstCase = lines.findIndex(line => line.startsWith("t(") || line.startsWith("await ta(")) + 1;
      // Not "aot-audit-..": the audit leaves every frame whose path has those words out of `from`, taking it for its own.
      using folder = tempDir("audited-members-" + name, {
        "cases.ts": text,
        "tsconfig.json": tsconfig,
        "package.json": JSON.stringify({ name: "app", type: "module" }),
      });
      const dir = String(folder);
      const plain = await spawned([bunExe(), "cases.ts"], dir);
      const build = await spawned([bunExe(), "build", "--compile", "--aot", "cases.ts", "--outfile", "built"], dir);
      expect(build.stderr + build.stdout).not.toContain("error:");
      expect(build.exitCode).toBe(0);
      const built = await spawned([join(dir, "built")], dir, { WHY: "1" });
      const audit = await spawned([bunExe(), "--aot-audit", "cases.ts"], dir);
      expect(audit.stdout).toBe(plain.stdout);

      const asPlain = answers(plain.stdout);
      const asBuilt = answers(built.stdout);
      // A record at a function that stands ahead of the cases counts for the case that called it: the first case among its callers.
      const foretold = new Set<number>();
      for (const line of audit.stderr.split("\n")) {
        const match = /^\[aot\] type-error [0-9a-f]{12} [a-z0-9-]+ [^: ]+:(\d+):\d+ .*; would-throw;/.exec(line);
        if (!match) continue;
        const numbers = [match[1], ...(line.split("; from ")[1] ?? "").matchAll(/cases\.ts:(\d+)/g).map(caller => caller[1])].map(
          written => Number(written) - lineOfFirstCase + 1,
        );
        foretold.add(numbers.find(number => asBuilt.has(number)) ?? numbers[0]);
      }
      expect(asBuilt.size).toBe(asPlain.size);
      expect(asBuilt.size).toBe(numberOfCases);
      // A record that stands on no case's line, at a helper or a declaration, would be judged by nobody.
      expect([...foretold].filter(number => !asBuilt.has(number))).toEqual([]);
      const falsely: string[] = [];
      const missed: string[] = [];
      const outOfDate: string[] = [];
      let named = 0;
      for (const [number, said] of asBuilt) {
        const written = lines[number + lineOfFirstCase - 2];
        const throws = said.startsWith("threw");
        if (foretold.has(number) && !throws) falsely.push(written);
        if (!throws || asPlain.get(number)!.startsWith("threw") || said.includes("the object matches")) continue;
        if (foretold.has(number)) {
          named++;
          if (written.includes("// silent: ")) outOfDate.push(written);
        } else if (!written.includes("// silent: ")) missed.push(written);
      }
      expect(falsely).toEqual([]);
      expect(missed).toEqual([]);
      expect(outOfDate).toEqual([]);
      expect(named).toBeGreaterThanOrEqual(namedAtLeast);
    },
    240_000,
  );
});
