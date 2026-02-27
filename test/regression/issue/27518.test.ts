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

      await new Promise<void>(resolve => {
        resolveWaiter = resolve;
      });
      resolveWaiter = null;
    }
  };

  const allOutput = () => stripAnsi(received.join(""));

  await waitFor(/\u276f|> /); // Wait for prompt

  await fn({ terminal, proc, send, waitFor, allOutput });

  // Clean exit
  send(".exit\n");
  await Promise.race([proc.exited, Bun.sleep(2000)]);
  if (!proc.killed) proc.kill();
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
      send("const myObj = { fooBar: 1, fooBaz: 2 }\n");
      await waitFor(/\u276f|> /);
      // Now tab-complete on myObj.foo
      send("myObj.foo\t");
      // Should show fooBar and fooBaz
      const output = await waitFor(/foo(Bar|Baz)/);
      const stripped = stripAnsi(output);
      expect(stripped).toMatch(/fooBar/);
      expect(stripped).toMatch(/fooBaz/);
    });
  });

  test("array dot-completion does not show global properties", async () => {
    await withTerminalRepl(async ({ send, waitFor, allOutput }) => {
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
});
