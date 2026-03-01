// Test for #27671: .copy command should work with external clipboard tools
// when OSC 52 is not supported by the terminal.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isMacOS, isWindows, tempDir } from "harness";
import path from "path";

// The REPL tries "pbcopy" on macOS, "xclip" on Linux.
const fakeClipboardName = isMacOS ? "pbcopy" : "xclip";

// Helper to run REPL with piped stdin and capture raw output (no ANSI stripping
// so we can inspect OSC 52 sequences when needed).
async function runRepl(
  input: string[],
  options: {
    env?: Record<string, string>;
  } = {},
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const inputStr = input.join("\n") + "\n";
  const { env = {} } = options;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "repl"],
    stdin: Buffer.from(inputStr),
    stdout: "pipe",
    stderr: "pipe",
    env: {
      ...bunEnv,
      TERM: "dumb",
      NO_COLOR: "1",
      ...env,
    },
  });

  const exitCode = await proc.exited;
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();

  return { stdout, stderr, exitCode };
}

describe("issue #27671 - .copy with external clipboard tools", () => {
  test.skipIf(isWindows)(".copy pipes text to external clipboard tool", async () => {
    using dir = tempDir("repl-copy-test", {});

    const clipOutputFile = `${dir}/clip-output.txt`;

    // Create a fake clipboard tool that saves stdin to a file
    const fakeClipboard = `${dir}/${fakeClipboardName}`;
    await Bun.write(fakeClipboard, `#!/bin/sh\ncat > "${clipOutputFile}"\n`);
    const { exitCode: chmodExit } = Bun.spawnSync({
      cmd: ["chmod", "+x", fakeClipboard],
    });
    expect(chmodExit).toBe(0);

    // Run the REPL with our fake tool first in PATH
    const { stdout, exitCode } = await runRepl([".copy 42", ".exit"], {
      env: {
        PATH: `${dir}:${process.env.PATH}`,
      },
    });

    const output = Bun.stripANSI(stdout);
    expect(output).toContain("Copied");
    expect(output).toContain("clipboard");

    // Verify the fake clipboard tool received the correct text
    const clipContent = await Bun.file(clipOutputFile).text();
    expect(clipContent).toBe("42");

    expect(exitCode).toBe(0);
  });

  test.skipIf(isWindows)(".copy pipes string value without quotes", async () => {
    using dir = tempDir("repl-copy-test2", {});

    const clipOutputFile = `${dir}/clip-output.txt`;
    const fakeClipboard = `${dir}/${fakeClipboardName}`;
    await Bun.write(fakeClipboard, `#!/bin/sh\ncat > "${clipOutputFile}"\n`);
    const { exitCode: chmodExit } = Bun.spawnSync({
      cmd: ["chmod", "+x", fakeClipboard],
    });
    expect(chmodExit).toBe(0);

    const { stdout, exitCode } = await runRepl([".copy 'hello world'", ".exit"], {
      env: {
        PATH: `${dir}:${process.env.PATH}`,
      },
    });

    const output = Bun.stripANSI(stdout);
    expect(output).toContain("Copied");

    const clipContent = await Bun.file(clipOutputFile).text();
    // String values are copied raw (without quotes)
    expect(clipContent).toBe("hello world");

    expect(exitCode).toBe(0);
  });

  test.skipIf(isWindows)(".copy falls back to OSC 52 when no external tools available", async () => {
    // Use an empty temp dir as the only PATH entry - no clipboard tools found
    using dir = tempDir("repl-copy-empty", {});

    const { stdout, exitCode } = await runRepl([".copy 42", ".exit"], {
      env: {
        // Only include bun's directory and our empty dir (no clipboard tools)
        PATH: `${dir}:${path.dirname(bunExe())}`,
      },
    });

    // Raw stdout should contain the OSC 52 escape sequence
    expect(stdout).toContain("\x1b]52;c;");

    const output = Bun.stripANSI(stdout);
    // Should still report success (via OSC 52 fallback)
    expect(output).toContain("Copied");
    expect(output).toContain("clipboard");
    expect(exitCode).toBe(0);
  });
});
