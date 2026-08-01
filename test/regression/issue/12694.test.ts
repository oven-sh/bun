// https://github.com/oven-sh/bun/issues/12694
// Ctrl+C at a raw-mode readline prompt (e.g. @inquirer/prompts) did not exit:
// readline correctly closed on 0x03, but load_entry_point then busy-spun on
// the never-settling top-level await at 100% CPU.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

// Bun.Terminal provides a PTY so process.stdin.isTTY is true and readline
// enables raw mode; on Windows raw-mode ^C is delivered differently.
test.skipIf(isWindows)("Ctrl+C at a raw-mode readline prompt exits instead of spinning on an unsettled TLA", async () => {
  // @inquirer/prompts@5 reduced to the part this issue exercises:
  //   readline.createInterface({ terminal: true }) + a top-level await.
  // In raw mode Ctrl+C arrives as byte 0x03; readline's kTtyWrite maps it to
  // close() → input.pause() + setRawMode(false). With nothing left alive,
  // the process must exit (Node: exit 13, unsettled TLA) rather than spin.
  const source = `
    import * as readline from "node:readline";
    const rl = readline.createInterface({
      terminal: true,
      input: process.stdin,
      output: process.stdout,
    });
    rl.on("close", () => console.log("rl-closed"));
    console.log("? prompt:");
    await new Promise(resolve => rl.on("line", resolve));
    console.log("unreachable");
  `;

  let output = "";
  const prompt = Promise.withResolvers<void>();
  const closed = Promise.withResolvers<void>();

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", source],
    env: bunEnv,
    terminal: {
      data(_t, chunk) {
        output += new TextDecoder().decode(chunk);
        if (output.includes("? prompt:")) prompt.resolve();
        if (output.includes("rl-closed")) closed.resolve();
      },
    },
  });
  const terminal = proc.terminal!;

  await prompt.promise;
  // Ctrl+C as a raw byte on the PTY.
  terminal.write("\x03");
  // readline must observe ^C and close (fails fast if the keypress path broke).
  await closed.promise;

  const exitCode = await proc.exited;

  expect(output).not.toContain("unreachable");
  expect(output).toContain("unsettled top-level await");
  // 13 = Node's "unsettled top-level await" exit code.
  expect(exitCode).toBe(13);
});

test.skipIf(isWindows)(
  "Ctrl+C at a raw-mode prompt with a signal-exit style process.emit override rejects the prompt (inquirer flow)",
  async () => {
    // @inquirer/core@5 layers signal-exit on top: it overrides process.emit to
    // observe 'exit' and reject the pending prompt. The .catch() must run.
    const source = `
      import * as readline from "node:readline";
      const originalEmit = process.emit;
      let rejectPrompt;
      process.emit = function (ev, ...args) {
        const ret = originalEmit.call(this, ev, ...args);
        if (ev === "exit") rejectPrompt?.(new Error("force closed " + args[0]));
        return ret;
      };
      const rl = readline.createInterface({
        terminal: true,
        input: process.stdin,
        output: process.stdout,
      });
      console.log("? prompt:");
      await new Promise((resolve, reject) => {
        rejectPrompt = reject;
        rl.on("line", l => { rl.close(); resolve(l); });
      }).catch(e => {
        console.log("CAUGHT " + e.message);
        process.exit(0);
      });
    `;

    let output = "";
    const prompt = Promise.withResolvers<void>();

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", source],
      env: bunEnv,
      terminal: {
        data(_t, chunk) {
          output += new TextDecoder().decode(chunk);
          if (output.includes("? prompt:")) prompt.resolve();
        },
      },
    });
    const terminal = proc.terminal!;

    await prompt.promise;
    terminal.write("\x03");

    const exitCode = await proc.exited;

    expect(output).toContain("CAUGHT force closed 13");
    expect(exitCode).toBe(0);
  },
);
