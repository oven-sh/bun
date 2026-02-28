// Tests for https://github.com/oven-sh/bun/issues/27518
// REPL tab completion should complete against the actual target object,
// not globalThis when there's a dot expression like `{}.toString`.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";

const stripAnsi = Bun.stripANSI;

async function withTerminalRepl(
  fn: (helpers: {
    terminal: Bun.Terminal;
    proc: Bun.ChildProcess;
    send: (text: string) => void;
    waitFor: (pattern: string | RegExp, timeoutMs?: number) => Promise<string>;
    allOutput: () => string;
  }) => Promise<void>,
) {
  const received: string[] = [];
  let cursor = 0;
  let resolveWaiter: (() => void) | null = null;

  await using terminal = new Bun.Terminal({
    cols: 120,
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

      // Race the data callback against the remaining deadline so we
      // re-check even when no new terminal data arrives.
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        new Promise<void>(resolve => {
          resolveWaiter = resolve;
        }),
        new Promise<void>(resolve => {
          timer = setTimeout(resolve, remaining);
        }),
      ]);
      clearTimeout(timer);
      resolveWaiter = null;
    }
  };

  const allOutput = () => stripAnsi(received.join(""));

  await waitFor(/\u276f|> /); // Wait for prompt

  await fn({ terminal, proc, send, waitFor, allOutput });

  // Clean exit — Ctrl+C to clear any pending input, then .exit.
  send("\x03");
  send(".exit\n");
  const exitCode = await Promise.race([proc.exited, Bun.sleep(5000).then(() => null as number | null)]);
  if (exitCode === null) {
    proc.kill();
    expect().fail("REPL process did not exit within 5 seconds after sending .exit");
  }
  expect(exitCode).toBe(0);
}

describe.todoIf(isWindows)("REPL tab completion targets correct object (#27518)", () => {
  test("object literal dot-completion shows Object.prototype methods", async () => {
    await withTerminalRepl(async ({ send, waitFor }) => {
      // Type `({}).to` and press Tab - should complete against Object.prototype
      // Object.prototype has `toString`, `toLocaleString` which start with "to"
      send("({}).to\t");
      // Should show toString or toLocaleString, NOT global properties
      const output = await waitFor(/to(String|LocaleString)/i);
      const stripped = stripAnsi(output);
      expect(stripped).toMatch(/to(String|LocaleString)/i);
    });
  });

  test("variable dot-completion shows correct properties", async () => {
    await withTerminalRepl(async ({ send, waitFor }) => {
      // First define a variable
      send("const myObj = { xyzOne: 1, xyzTwo: 2 }\n");
      // Wait for the REPL to finish evaluating by looking for the evaluation
      // output (the object is printed back). Then wait for the next prompt.
      // This ensures the cursor is past all echoed definition characters.
      await waitFor("xyzTwo");
      await waitFor(/\u276f|> /);
      // Now tab-complete on myObj.xyz
      send("myObj.xyz\t");
      // Should show xyzOne and xyzTwo
      const output = await waitFor(/xyz(One|Two)/);
      const stripped = stripAnsi(output);
      expect(stripped).toMatch(/xyzOne/);
      expect(stripped).toMatch(/xyzTwo/);
    });
  });

  test("array dot-completion does not show global properties", async () => {
    await withTerminalRepl(async ({ send, waitFor }) => {
      // [1,2,3].a should NOT show addEventListener, alert, atob etc.
      // Array.prototype has no properties starting with 'a' (at() starts with 'a' in modern engines)
      send("[1,2,3].pus\t");
      // Should complete to "push" from Array.prototype
      const output = await waitFor("push");
      const stripped = stripAnsi(output);
      expect(stripped).toContain("push");
      // Should NOT contain global properties
      expect(stripped).not.toContain("addEventListener");
    });
  });

  test("globalThis completion still works for bare identifiers", async () => {
    await withTerminalRepl(async ({ send, waitFor }) => {
      // Typing just "cons" and tab should still complete from globalThis
      send("cons\t");
      const output = await waitFor("console");
      const stripped = stripAnsi(output);
      expect(stripped).toContain("console");
    });
  });

  test("dot-completion after assignment does not cause side effects", async () => {
    await withTerminalRepl(async ({ send, waitFor }) => {
      // Define a variable and wait for REPL to process it
      send("let sideEffectVar = 'original'\n");
      await waitFor("original");
      await waitFor(/\u276f|> /);
      // Type an assignment with dot-completion — tab should NOT evaluate "sideEffectVar = {}"
      // It should only evaluate "{}" (the expression right before the dot).
      send("sideEffectVar = {}.to\t");
      await waitFor(/to(String|LocaleString)/i);
      // Cancel the current line
      send("\x03");
      await waitFor(/\u276f|> /);
      // Verify sideEffectVar was NOT modified by the tab completion
      send("sideEffectVar\n");
      const output = await waitFor("original");
      expect(stripAnsi(output)).toContain("original");
    });
  });
});
