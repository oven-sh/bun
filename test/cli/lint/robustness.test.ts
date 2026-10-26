// Runs `bun lint` on inputs that are large in one dimension. It must not overflow the stack or run out of memory, and
// its run time must be linear in the input size. The inputs, and what each one used to cause, are in
// oracle/robustness/cases.ts, except the JSX entity inputs at the end of this file. A case can't specify a run time,
// and the old code finishes those within the limit, so their tests compare the CPU times of two texts of one size.
import { afterAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { endChildren, spawn } from "../children";
import { cases } from "./oracle/robustness/cases";
import { configOf, countByRule } from "./oracle/robustness/run";

afterAll(endChildren);

const env = {
  ...bunEnv,
  AGENT: "0",
  CLAUDECODE: undefined,
  REPL_ID: undefined,
  GITHUB_ACTIONS: undefined,
  NO_COLOR: "1",
};

// These limits aren't what's tested. They keep a regression from taking down the machine. A release build needs at most
// half a second for a case, and a tenth of that for most of them, while the old code either crashes or exceeds the
// limit.
const isSlowBuild = isDebug || isASAN;
const seconds = isSlowBuild ? 120 : 10;
// A sanitizer reserves terabytes of address space.
const limit = isLinux && !isASAN ? "ulimit -v 4000000; " : "";

describe.concurrent("bun lint", () => {
  test.each(cases.filter(it => !(it.isHeavy && isSlowBuild)).map(it => [it.name, it] as const))(
    "%s",
    async (_, it) => {
      const [configName, config] = configOf(it);
      using dir = tempDir("bun-lint-robustness", {
        [configName]: config,
        [it.file]: it.text(),
        ...(it.compilerOptions && { "tsconfig.json": JSON.stringify({ compilerOptions: it.compilerOptions }) }),
      });
      const args = ["lint", "-c", configName, "--threads", "2", ...(it.args ?? ["-f", "unix"]), it.file];
      await using proc = spawn({
        cmd: isWindows ? [bunExe(), ...args] : ["sh", "-c", `ulimit -c 0; ${limit}exec "$0" "$@"`, bunExe(), ...args],
        env,
        cwd: String(dir),
        stdout: "pipe",
        stderr: "pipe",
        timeout: seconds * 1000,
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      const text = readFileSync(join(String(dir), it.file), "utf8");
      if (it.keeps) expect(text.match(it.keeps[0])?.length ?? 0).toBe(it.keeps[1]);
      if (it.length === "as before") expect(text === it.text()).toBe(true);
      else if (it.length !== undefined) expect(Buffer.byteLength(text)).toBe(it.length);
      // Don't put the whole output in a failure message, because it's megabytes long.
      if (it.lacks) expect(stdout.match(it.lacks)?.[0]).toBeUndefined();
      if (it.reports && !it.orWarns?.test(stdout + stderr)) {
        const found = countByRule(stdout);
        const isAsExpected = Bun.deepEquals(found, it.reports);
        // If neither matched, include the end of the output, where the warning should have been.
        expect(it.orWarns && !isAsExpected ? [found, (stdout + stderr).slice(-500)] : found).toEqual(it.reports);
      }
      if (it.matches) expect(it.matches.test(stdout)).toBe(true);
      const allowed = [it.exitCode].flat();
      const isAllowed = allowed.includes(exitCode);
      expect({ signal: proc.signalCode, exitCode, stderr: isAllowed ? "" : stderr.slice(-500) }).toEqual({
        signal: null,
        exitCode: isAllowed ? exitCode : allowed[0],
        stderr: "",
      });
    },
    (seconds + 5) * 1000,
  );
});

describe("bun lint reads the entities of JSX text", () => {
  const config = { ".oxlintrc.json": JSON.stringify({ categories: { correctness: "off" } }) };
  /** Lints `file`, which has nothing to report, and returns the CPU time in microseconds. */
  async function cpuTimeOf(dir: { toString(): string }, file: string) {
    await using proc = spawn({
      cmd: [bunExe(), "lint", "-c", ".oxlintrc.json", "--threads", "1", "-f", "unix", file],
      env,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
      timeout: seconds * 1000,
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ signal: proc.signalCode, exitCode, stdout, stderr }).toEqual({
      signal: null,
      exitCode: 0,
      stdout: "",
      stderr: "",
    });
    return Number(proc.resourceUsage()!.cpuTime.total);
  }

  // An entity ends at the first `;` after its `&`, and the lexer remembers where it found that `;`. Nothing prints
  // the text that the lexer decodes, so this only shows that the lexer gets through each line. In the last line, an
  // offset that is wrong by one byte is inside the `€`.
  test("with a `&` before, between and after the `;` of other entities", async () => {
    const lines = [
      "&amp;&lt;",
      "a & b &amp; c",
      "&amp; & &lt;",
      "&lt;;&amp;",
      "& &; &amp",
      "&#65;&#x42; & &nope; &",
      "10&#160;€",
    ];
    using dir = tempDir("bun-lint-robustness", {
      ...config,
      "a.tsx": `export const a = (\n  <p>\n    ${lines.join("\n    ")}\n  </p>\n);\n`,
    });
    await cpuTimeOf(dir, "a.tsx");
  });

  // Each `&` used to search all of the text after it for a `;`.
  test.each([
    ["no `;`", ""],
    ["one `;` at the end", ";"],
  ])(
    "in linear time when one line has many `&` and %s",
    async (_, end) => {
      const pieces = isSlowBuild ? 64_000 : 256_000;
      const text = (piece: string) => `export const a = <p>${Buffer.alloc(piece.length * pieces, piece)}${end}</p>;\n`;
      // In `&; x` each `&` has its `;` next to it, so that text takes the same path without the long searches.
      using dir = tempDir("bun-lint-robustness", { ...config, "odd.tsx": text("& x "), "plain.tsx": text("&; x") });
      const plain = await cpuTimeOf(dir, "plain.tsx");
      // Windows measures CPU time in ticks of 1/64 s, so a short run can report 0.
      expect((await cpuTimeOf(dir, "odd.tsx")) / Math.max(plain, isWindows ? 1e6 / 64 : 1)).toBeLessThan(8);
    },
    (seconds + 5) * 1000,
  );
});
