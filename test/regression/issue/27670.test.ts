// Regression test for #27670: bun repl duplicated lines when pasting text
// that exceeds terminal width.
//
// When pasting text wider than the available terminal columns, the REPL's
// refreshLine() used to only clear the current terminal line, leaving
// "ghost" copies of the wrapped text on rows above/below. The fix adds
// cursor-up sequences to return to the first row and clear all wrapped
// rows before redrawing.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

const stripAnsi = Bun.stripANSI;

// Helper to run REPL in a PTY with a specific terminal width and capture raw output
async function withNarrowTerminalRepl(
  cols: number,
  fn: (helpers: {
    terminal: Bun.Terminal;
    proc: Bun.ChildProcess;
    send: (text: string) => void;
    waitFor: (pattern: string | RegExp, timeoutMs?: number) => Promise<string>;
    allOutput: () => string;
    rawOutput: () => string;
  }) => Promise<void>,
) {
  const received: string[] = [];
  let cursor = 0;
  let resolveWaiter: (() => void) | null = null;

  await using terminal = new Bun.Terminal({
    cols,
    rows: 40,
    data(_term, data) {
      const str = Buffer.from(data).toString();
      received.push(str);
      if (resolveWaiter) {
        resolveWaiter();
        resolveWaiter = null;
      }
    },
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "repl"],
    terminal,
    env: {
      ...bunEnv,
      TERM: "xterm-256color",
    },
  });

  const send = (text: string) => terminal.write(text);

  const waitFor = async (pattern: string | RegExp, timeoutMs = 5000): Promise<string> => {
    const deadline = Date.now() + timeoutMs;
    while (true) {
      const all = received.join("");
      const recent = all.slice(cursor);
      const matched = typeof pattern === "string" ? recent.includes(pattern) : pattern.test(recent);
      if (matched) {
        cursor = all.length;
        return recent;
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        throw new Error(
          `Timed out waiting for pattern: ${pattern}\nReceived so far:\n${stripAnsi(received.join("").slice(cursor))}`,
        );
      }
      await new Promise<void>(resolve => {
        resolveWaiter = resolve;
      });
      resolveWaiter = null;
    }
  };

  const allOutput = () => stripAnsi(received.join(""));
  const rawOutput = () => received.join("");

  await waitFor(/\u276f|> /); // Wait for initial prompt

  await fn({ terminal, proc, send, waitFor, allOutput, rawOutput });

  // Clean exit
  send(".exit\n");
  await Promise.race([proc.exited, Bun.sleep(2000)]);
  if (!proc.killed) proc.kill();
}

describe.todoIf(isWindows)("REPL wrapped line duplication (#27670)", () => {
  test("refreshLine emits cursor-up sequences when content wraps", async () => {
    const termWidth = 40;
    // The prompt "❯ " takes 2 visible columns. With 40 chars of input,
    // total = 42 > 40, causing wrapping. We need at least 2 chars past the
    // wrap point so that the second wrapped refresh sees prev_extra_lines > 0
    // and emits cursor-up sequences to clean up the previous wrapped content.
    const overflowInput = "x".repeat(termWidth);

    await withNarrowTerminalRepl(termWidth, async ({ send, waitFor, rawOutput }) => {
      // Send text that will wrap past the terminal width
      send(overflowInput);
      // Wait until all characters appear in output
      await waitFor("x".repeat(termWidth));

      // Check the raw output for cursor-up escape sequences (CSI n A).
      // The fix adds these to move the cursor back to the first row before
      // clearing and redrawing wrapped content. Without the fix, there are
      // no cursor-up sequences and ghost lines accumulate.
      const raw = rawOutput();
      const cursorUpPattern = /\x1b\[\d+A/;
      expect(cursorUpPattern.test(raw)).toBe(true);
    });
  });

  test("long expression evaluates correctly after wrapping", async () => {
    const termWidth = 30;

    await withNarrowTerminalRepl(termWidth, async ({ send, waitFor }) => {
      // Type a valid JS expression wider than the terminal
      // "1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1" is 31 chars, + 2 for prompt = 33 > 30
      const expr = "1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1";
      send(expr + "\n");

      // The result should be 16
      await waitFor("16");
    });
  });

  test("subsequent expression works after wrapped input", async () => {
    const termWidth = 30;

    await withNarrowTerminalRepl(termWidth, async ({ send, waitFor }) => {
      // Type a long expression that wraps
      send("1+1+1+1+1+1+1+1+1+1+1+1+1+1+1+1\n");
      await waitFor("16");

      // Type a short expression — should work fine
      send("2 + 3\n");
      await waitFor("5");
    });
  });

  test("wrapped content is cleaned up when line is cleared", async () => {
    const termWidth = 30;

    await withNarrowTerminalRepl(termWidth, async ({ send, waitFor }) => {
      // Type enough to wrap: 35 + 2 prompt = 37 > 30
      const longText = "a".repeat(35);
      send(longText);
      // Wait for the full text to appear in output
      await waitFor("a".repeat(35));

      // Clear the line with Ctrl+U, then wait for the prompt to reappear
      // (refreshLine redraws a clean prompt after clearing the line)
      send("\x15"); // Ctrl+U
      await waitFor(/\u276f|> /);

      // Type a short expression — it should evaluate correctly
      send("42\n");
      await waitFor("42");
    });
  });
});
