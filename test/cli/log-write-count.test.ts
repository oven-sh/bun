import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, runCommandWriteCount, tempDir } from "harness";
import { join } from "node:path";

// A command prints its log (errors, warnings and their notes) to stderr through a 4 KB buffer,
// not with one write(2) for each piece of a message or for each space under a source line.
//
// write(2) calls are counted from /proc/<pid>/io, which only Linux has.
describe.skipIf(!isLinux)("bun build writes its log to stderr a buffer at a time", () => {
  const fixtures = {
    "one/one.mjs": "const aaaaaaaaaaaaaaa = 1, bbbbbbbbbbbb = 2 +;\n",
    // Each assignment is an error with a note, and its caret is 15 columns further right.
    "many/many.mjs": `const c=0;${Buffer.alloc(100 * 15, "try{c=1}catch{}")}\n`,
    // The loader of bunfig.toml prints its own log, with the password masked.
    "bunfig/ok.mjs": "export default 1;\n",
    "bunfig/bunfig.toml": `l;password = "${Buffer.alloc(64, "x")}"\n`,
  };

  test.concurrent.each([
    ["NO_COLOR", { ...bunEnv, NO_COLOR: "1" }],
    ["FORCE_COLOR", { ...bunEnv, FORCE_COLOR: "1", NO_COLOR: "0" }],
  ])("%s", async (_, env) => {
    using dir = tempDir("log-write-count", fixtures);
    const build = async (cwd: string, file: string) => {
      const result = await runCommandWriteCount({
        cmd: [bunExe(), "build", file, "--outdir", "out"],
        cwd: join(String(dir), cwd),
        env,
      });
      return { ...result, stderr: Bun.stripANSI(result.stderr), bytes: result.stderr.length };
    };

    const one = await build("one", "./one.mjs");
    expect(one.stderr).toStartWith(
      `1 | const aaaaaaaaaaaaaaa = 1, bbbbbbbbbbbb = 2 +;\n${Buffer.alloc(49, " ")}^\nerror: Unexpected ;\n`,
    );
    // One write holds the log. The others do not go to stderr.
    expect(one.writes).toBeLessThan(8);
    expect(one.exitCode).toBe(1);

    const many = await build("many", "./many.mjs");
    expect(many.stderr.match(/^error: Cannot assign to "c" because it is a constant$/gm)).toHaveLength(100);
    expect(many.bytes).toBeGreaterThan(4 * 4096);
    // Two writes in a row hold more than 4 KB together.
    expect(many.writes).toBeLessThan(many.bytes / 2048 + 8);
    expect(many.exitCode).toBe(1);

    const bunfig = await build("bunfig", "./ok.mjs");
    expect(bunfig.stderr).toStartWith(
      `1 | l;password = "${Buffer.alloc(64, "*")}"\n     ^\nerror: Expected '=' after a key but found (redacted)\n`,
    );
    expect(bunfig.writes).toBeLessThan(8);
    expect(bunfig.exitCode).toBe(1);
  });
});
