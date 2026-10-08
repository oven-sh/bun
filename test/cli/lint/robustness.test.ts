// `bun lint` on inputs that are large in one dimension: it does not overflow the stack, does not run out of memory, and takes time
// in proportion to the size of the input. The inputs, and what each of them did once, are in oracle/robustness/cases.ts.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cases } from "./oracle/robustness/cases";
import { configOf, countByRule } from "./oracle/robustness/run";

const env = {
  ...bunEnv,
  AGENT: "0",
  CLAUDECODE: undefined,
  REPL_ID: undefined,
  GITHUB_ACTIONS: undefined,
  NO_COLOR: "1",
};

// Not what is tested: they keep a regression from taking the machine along. A release build needs half a second at most for a
// case, most of them a tenth of that, and the code as it was before either crashes or needs more than the limit.
const isSlowBuild = isDebug || isASAN;
const seconds = isSlowBuild ? 120 : 10;
// A sanitizer reserves terabytes of address space.
const limit = isLinux && !isASAN ? "ulimit -v 4000000; " : "";

describe.concurrent("bun lint", () => {
  test.each(cases.filter(it => !it.isSlow && !(it.isHeavy && isSlowBuild)).map(it => [it.name, it] as const))(
    "%s",
    async (_, it) => {
      const [configName, config] = configOf(it);
      using dir = tempDir("bun-lint-robustness", { [configName]: config, [it.file]: it.text() });
      const args = ["lint", "-c", configName, "--threads", "2", ...(it.args ?? ["-f", "unix"]), it.file];
      await using proc = Bun.spawn({
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
      // Not the whole output in a failure message: it has megabytes.
      if (it.lacks) expect(stdout.match(it.lacks)?.[0]).toBeUndefined();
      if (it.reports) expect(countByRule(stdout)).toEqual(it.reports);
      if (it.matches) expect(it.matches.test(stdout)).toBe(true);
      expect({ signal: proc.signalCode, exitCode, stderr: exitCode === it.exitCode ? "" : stderr.slice(-500) }).toEqual(
        {
          signal: null,
          exitCode: it.exitCode,
          stderr: "",
        },
      );
    },
    (seconds + 5) * 1000,
  );
});
