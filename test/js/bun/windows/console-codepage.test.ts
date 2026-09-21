// The console output codepage is shared by every process on the console. In
// `bun a | bun b`, `a` restores the codepage it saved at startup when it exits
// while `b` is still writing, and `b` then writes back the UTF-8 value `a` had
// set. So bun writes UTF-16 to the console (no dependence on the codepage) and
// restores only a codepage it changed itself. See #43660.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

const ffiSetup = `
  const { dlopen } = require("bun:ffi");
  const k32 = dlopen("kernel32.dll", {
    GetConsoleOutputCP: { args: [], returns: "u32" },
    SetConsoleOutputCP: { args: ["u32"], returns: "i32" },
    GetConsoleCP: { args: [], returns: "u32" },
    SetConsoleCP: { args: ["u32"], returns: "i32" },
  });
`;

/** Run `script` in a child bun attached to a fresh ConPTY and return what the
 *  terminal rendered. */
async function runInConsole(script: string): Promise<{ output: string; exitCode: number | null }> {
  let output = "";
  const eof = Promise.withResolvers<void>();
  const decoder = new TextDecoder();
  const proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    terminal: {
      cols: 200,
      rows: 50,
      data(_t, chunk: Uint8Array) {
        output += decoder.decode(chunk, { stream: true });
      },
      exit() {
        eof.resolve();
      },
    },
  });
  // EOF fires after the last buffered data was delivered.
  await eof.promise;
  await proc.exited;
  proc.terminal?.close();
  output += decoder.decode();
  return { output, exitCode: proc.exitCode };
}

describe.skipIf(!isWindows)("Windows console codepage", () => {
  test("console output does not depend on the console output codepage", async () => {
    const { output, exitCode } = await runInConsole(`
      ${ffiSetup}
      // 437 is the OEM codepage on every Windows install. A console that
      // decodes UTF-8 bytes with it renders "日本語" as "µùÑµ£¼Φ¬₧".
      if (k32.symbols.SetConsoleOutputCP(437) === 0) throw new Error("SetConsoleOutputCP failed");
      console.log("log=日本語");
      console.error("error=日本語");
      process.stdout.write("stdout=日本語\\n");
      // One character split across two writes, as a buffered writer that
      // flushes on a byte count does.
      const bytes = Buffer.from("日");
      process.stdout.write("split=");
      process.stdout.write(bytes.subarray(0, 1));
      process.stdout.write(bytes.subarray(1));
      process.stdout.write("\\n");
      // A byte that is not UTF-8 must not hold back the text after it.
      process.stdout.write(Buffer.from([0x6c, 0x61, 0x74, 0x69, 0x6e, 0x3d, 0xe9]));
      process.stdout.write("|next\\n");
      process.stderr.write("esplit=");
      process.stderr.write(bytes.subarray(0, 2));
      process.stderr.write(bytes.subarray(2));
      process.stderr.write("\\n");
      // Longer than one WriteConsoleW chunk, with the chunk cut inside a
      // character.
      process.stdout.write("big=x" + Buffer.alloc(1200, "日").toString() + "\\n");
    `);
    expect(output).toContain("log=日本語");
    expect(output).toContain("error=日本語");
    expect(output).toContain("stdout=日本語");
    expect(output).toContain("split=日");
    expect(output).toContain("latin=\uFFFD|next");
    expect(output).toContain("esplit=日");
    expect(output).toContain("big=x" + Buffer.alloc(150, "日").toString());
    // A character cut between two chunks would render as two U+FFFD.
    expect(output).not.toMatch(/\uFFFD[日\uFFFD]|日\uFFFD/);
    expect(exitCode).toBe(0);
  });

  test("exit restores only a codepage the process changed", async () => {
    const { output, exitCode } = await runInConsole(`
      ${ffiSetup}
      const { spawnSync } = require("node:child_process");
      const run = script => {
        const r = spawnSync(process.execPath, ["-e", script], { stdio: "inherit" });
        if (r.status !== 0) throw new Error("child failed: " + r.status);
      };
      const cp = () => k32.symbols.GetConsoleOutputCP() + "/" + k32.symbols.GetConsoleCP();

      // Bun already set UTF-8 at startup. A child that starts at UTF-8 has
      // nothing to put back, even if the codepage changes while it runs.
      run(\`${ffiSetup} k32.symbols.SetConsoleOutputCP(437); k32.symbols.SetConsoleCP(437);\`);
      console.log("after-child-at-utf8=" + cp());

      // A child that starts at another codepage restores it at exit.
      run("0");
      console.log("after-child-at-437=" + cp());

      k32.symbols.SetConsoleOutputCP(65001);
      k32.symbols.SetConsoleCP(65001);
    `);
    expect(output).toContain("after-child-at-utf8=437/437");
    expect(output).toContain("after-child-at-437=437/437");
    expect(exitCode).toBe(0);
  });
});
