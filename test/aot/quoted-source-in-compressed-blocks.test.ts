// An executable stores the source that error messages quote.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { canTrim } from "../bundler/compile-trim-features";
import { run } from "./harness/run";
import { test } from "./supported";

const numberOfExpressions = 8000;
const expressionAt = (at: number) => `holder.${"part".repeat(at % 5)}missing${at}.called${at}`;

function writeProgram() {
  const lines = [`import vm from "node:vm";`, "const holder = {};", "const all = [];"];
  for (let at = 0; at < numberOfExpressions; at++) lines.push(`all.push(() => ${expressionAt(at)}());`);
  lines.push(
    `const order = process.argv[2] === "backward" ? all.toReversed() : all;`,
    `const hasher = new Bun.CryptoHasher("sha1");`,
    `let length = 0;`,
    `for (const each of order) {\n  try {\n    each();\n  } catch (error) {\n    length += error.message.length;\n    hasher.update(error.message);\n  }\n}`,
    `console.log(all.length, length, hasher.digest("hex"));`,
    `try {\n  order[0]();\n} catch (error) {\n  console.log(error.message);\n}`,
    `console.log(vm.runInNewContext("try { f(); } catch (error) { error.message; }", { f: all[1717] }));`,
  );
  return lines.join("\n") + "\n";
}

test("every message quotes its expression", async () => {
  using dir = tempDir("aot-quoted-source", { "program.js": writeProgram() });
  const cwd = String(dir);
  const executable = (name: string) => join(cwd, isWindows ? name + ".exe" : name);
  const ways: Record<string, string[]> = { compiled: [] };
  if (canTrim) ways.trimmed = ["--trim"];
  for (const [name, flags] of Object.entries(ways)) {
    const build = await run(
      [bunExe(), "build", "--compile", "--aot", ...flags, "program.js", "--outfile", executable(name)],
      cwd,
    );
    expect({ name, stderr: build.stderr, exitCode: build.exitCode }).toEqual({
      name,
      stderr: expect.not.stringMatching(/^error\b/m),
      exitCode: 0,
    });
  }

  for (const order of ["forward", "backward"]) {
    const expected = await run([bunExe(), "program.js", order], cwd, bunEnv);
    expect(expected.exitCode).toBe(0);
    expect(expected.stdout).toContain(
      `(evaluating '${expressionAt(order === "forward" ? 0 : numberOfExpressions - 1)}')`,
    );
    for (const way of Object.keys(ways))
      expect({ way, order, ...(await run([executable(way), order], cwd, bunEnv)) }).toEqual({
        way,
        order,
        ...expected,
      });
  }
}, 600_000);
