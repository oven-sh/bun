import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// JSC skips an already-seen nested function body via its SourceProviderCache. After skipping a body whose last token
// spans lines (a template literal ending an arrow's expression body), it used to resume on the line that token
// *started* on, so every position after it in the enclosing function was reported lines too early. Positions must be
// the same whether the body was skipped or parsed.
test.concurrent.each([[{}], [{ BUN_JSC_useSourceProviderCache: "0" }]])("line numbers after a multi-line template literal ending an arrow body (%o)", async env => {
  const source = [
    "function outer() {", // 1
    "  const f = x => `a", // 2
    "b", // 3
    "c`;", // 4
    '  return new Error("here").stack.split("\\n")[1];', // 5
    "}",
    "console.log(outer());",
  ].join("\n");
  await using proc = Bun.spawn({ cmd: [bunExe(), "-e", source], env: { ...bunEnv, ...env }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.trim()).toEndWith("[eval]:5:14)"); // 2:18 when the lexer resumed on the template literal's first line
  expect(exitCode).toBe(0);
});
