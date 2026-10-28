import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { unsupported } from "./run-programs";
import { tsconfig } from "./runtime-use-harness";

const files = {
  "tsconfig.json": tsconfig,
  "main.ts": `declare const Bun: any, console: any;\nconsole.log(new Bun.Glob("*.ts").match("a.ts"));\n`,
};
const prefix = "aot: trim: ";
const notBlocked = "the compiler can see every API this program uses";

const commands: [spelling: string, cmd: string[], env?: Record<string, string>][] = [
  [
    "bun build --compile --aot --explain=trim",
    ["build", "--compile", "--aot", "--explain=trim", "main.ts", "--outfile", "program"],
  ],
  [
    "bun build --compile --aot, with the option in BUN_OPTIONS",
    ["build", "--compile", "--aot", "main.ts", "--outfile", "program"],
    { BUN_OPTIONS: "--explain=trim" },
  ],
  ["bun compile --explain=trim", ["compile", "--explain=trim", "main.ts", "--outfile", "program"]],
  ["bun check --aot --explain=trim", ["check", "--aot", "--no-pretty", "--explain=trim", "main.ts"]],
];

describe.skipIf(!!unsupported)("the trim report", () => {
  test.concurrent.each(commands)("is printed by %s", async (_, cmd, env = {}) => {
    using dir = tempDir("trim-report", files);
    const { stdout, stderr, exitCode } = await run([bunExe(), ...cmd], String(dir), {
      ...bunEnv,
      NO_COLOR: "1",
      ...env,
    });
    const lines = stderr
      .split("\n")
      .filter(line => line.startsWith(prefix))
      .map(line => line.slice(prefix.length));
    expect(lines[0]).toBe(notBlocked);
    expect(lines).toContain("uses Bun Glob");
    expect(lines).not.toContain("uses Bun serve");
    expect(stdout).not.toContain(prefix);
    expect(exitCode).toBe(0);
  });

  test("is in the logs of Bun.build with compile.aotExplain", async () => {
    using dir = tempDir("trim-report", files);
    const built = await Bun.build({
      entrypoints: [join(String(dir), "main.ts")],
      compile: { outfile: join(String(dir), "program"), aot: true, aotExplain: "trim" },
    });
    const lines = built.logs
      .filter(log => log.message.startsWith("trim: "))
      .map(log => log.message.slice("trim: ".length));
    expect(lines[0]).toBe(notBlocked);
    expect(lines).toContain("uses Bun Glob");
    expect(lines).not.toContain("uses Bun serve");
  });
});
