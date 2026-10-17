import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe("parseArgs allowNegative", () => {
  test("bare '--no-' stores an empty key", async () => {
    // The stripped name is a zero-length string. It must become the "" property key, not a crash.
    const script = `
      const { parseArgs } = require("node:util");
      const result = parseArgs({ args: ["--no-"], allowNegative: true, strict: false, tokens: true });
      console.log(JSON.stringify(result));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      values: { "": false },
      positionals: [],
      tokens: [{ kind: "option", name: "", rawName: "--no-", index: 0 }],
    });
    expect(exitCode).toBe(0);
  });
});
