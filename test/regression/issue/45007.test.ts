import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Assignment to a `const` binding is a runtime TypeError (ECMA-262 PutValue ->
// SetMutableBinding), not an early error. A module whose assignment never runs must load.
async function run(files: Record<string, string>, entry: string) {
  using dir = tempDir("issue-45007", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), entry],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.each([
  ["literal initializer", "const e = 1;"],
  ["non-literal initializer", "const e = Math.random();"],
])("unexecuted assignment to a const loads (%s)", async (_name, decl) => {
  const { stdout, stderr, exitCode } = await run(
    { "index.js": `${decl}\nfunction f() { e = 2 }\nconsole.log("loaded");\n` },
    "index.js",
  );
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "loaded\n", stderr: "", exitCode: 0 });
});

test("unexecuted assignment to a const loads from a required CommonJS file", async () => {
  const { stdout, stderr, exitCode } = await run(
    {
      "chunk.cjs": `const t = 1;\nfunction f() { t = 2 }\nmodule.exports = "chunk";\n`,
      "index.js": `console.log(require("./chunk.cjs"));\n`,
    },
    "index.js",
  );
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "chunk\n", stderr: "", exitCode: 0 });
});

test.each([
  ["literal initializer", "const e = 1;"],
  ["non-literal initializer", "const e = Math.random();"],
])("executed assignment to a const throws TypeError at runtime (%s)", async (_name, decl) => {
  const { stdout, stderr, exitCode } = await run(
    {
      "index.js": `${decl}\ntry { e = 2 } catch (err) { console.log(err instanceof TypeError, typeof e) }\n`,
    },
    "index.js",
  );
  expect({ stdout, stderr, exitCode }).toEqual({ stdout: "true number\n", stderr: "", exitCode: 0 });
});
