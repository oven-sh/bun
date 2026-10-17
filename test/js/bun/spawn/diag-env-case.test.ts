// Diagnostic only. On Windows, which of two env keys that differ only in case does a child of Bun.spawn see,
// and does that depend on the other variables?
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

test.skipIf(!isWindows)("Path and PATH in one env object", () => {
  const cmd = process.env.ComSpec!;
  const keysOfPath = Object.keys(bunEnv).filter(key => key.toUpperCase() === "PATH");
  const lines = [`bunEnv has ${Object.keys(bunEnv).length} keys; those that spell PATH: ${JSON.stringify(keysOfPath)}`];

  // "L": the key added last comes later in the child's block. "f": it comes first. "1": there is only one.
  const order = (env: Record<string, string | undefined>, prefix: string, last: string) => {
    const { stdout } = Bun.spawnSync({ cmd: [cmd, "/d", "/c", "set", prefix], env, stdout: "pipe", stderr: "ignore" });
    const found = stdout
      .toString()
      .split(/\r?\n/)
      .filter(line => line.slice(0, line.indexOf("=")).toUpperCase() === prefix.toUpperCase());
    return found.length === 1 ? "1" : found.at(-1)!.endsWith("=" + last) ? "L" : "f";
  };
  for (const [name, where] of [
    ["before P", "A"],
    ["after P", "Z"],
    ["around P", "AZ"],
  ]) {
    let path = "",
      other = "";
    for (let extra = 0; extra <= 60; extra++) {
      const env: Record<string, string | undefined> = { ...bunEnv, Diag_Case: "first" };
      for (let i = 0; i < extra; i++) env[where[i % where.length] + "_DIAG_EXTRA_" + i] = "x";
      env.PATH = "C:\\last";
      env.DIAG_CASE = "last";
      path += order(env, "PATH", "C:\\last");
      other += order(env, "DIAG_CASE", "last");
    }
    lines.push(`0..60 more variables ${name}: PATH      ${path}`);
    lines.push(`0..60 more variables ${name}: DIAG_CASE ${other}`);
  }

  // What a bun child makes of each order.
  const seen = new Map<string, string>();
  for (let extra = 0; extra <= 60 && seen.size < 2; extra++) {
    const env: Record<string, string | undefined> = { ...bunEnv };
    for (let i = 0; i < extra; i++) env["A_DIAG_EXTRA_" + i] = "x";
    env.PATH = "C:\\last";
    const which = order(env, "PATH", "C:\\last");
    if (seen.has(which)) continue;
    const { stdout } = Bun.spawnSync({
      cmd: [bunExe(), "-e", "console.log(process.env.PATH === 'C:\\\\last' ? 'the last key' : 'the first key')"],
      env,
      stdout: "pipe",
      stderr: "ignore",
    });
    seen.set(which, stdout.toString().trim());
  }
  lines.push("a bun child's process.env.PATH is, by order in the block: " + JSON.stringify([...seen]));

  // Fails on purpose: CI prints the output of failing files only.
  expect(lines.join("\n")).toBe("");
});
