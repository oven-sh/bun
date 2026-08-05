import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/32108
// Pasting multi-line text into the interactive `bun feedback` prompt must
// insert the whole text instead of submitting at the first newline.
//
// Skipped on Windows: ConPTY rewrites VT input sequences, so the raw
// bracketed-paste bytes this test writes are not delivered verbatim to the
// child process.
describe.concurrent.skipIf(isWindows)("bun feedback interactive prompt", () => {
  const expected = "first line\nsecond line\nthird line";

  async function runFeedbackWithTerminalInput(writes: string[]): Promise<{ message: string; exitCode: number }> {
    const { promise: messagePromise, resolve: resolveMessage } = Promise.withResolvers<string>();

    await using server = Bun.serve({
      port: 0,
      async fetch(req) {
        const form = await req.formData();
        resolveMessage(String(form.get("message")));
        return new Response("ok");
      },
    });

    using dir = tempDir("feedback-paste", {});

    const received: string[] = [];
    let notifyData: (() => void) | null = null;
    const notify = () => {
      notifyData?.();
      notifyData = null;
    };

    await using terminal = new Bun.Terminal({
      cols: 120,
      rows: 40,
      data(_terminal, data) {
        received.push(Buffer.from(data).toString());
        notify();
      },
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "feedback", "--email", "test@example.com"],
      terminal,
      cwd: String(dir),
      env: {
        ...bunEnv,
        TERM: "xterm-256color",
        BUN_FEEDBACK_URL: `http://localhost:${server.port}/`,
        BUN_INSTALL: String(dir),
      },
    });

    let exitCode: number | null = null;
    const exited = proc.exited.then(code => {
      exitCode = code;
      notify();
      return code;
    });

    const output = () => Bun.stripANSI(received.join(""));

    // Wait for the interactive prompt before writing any input.
    const deadline = Date.now() + 20_000;
    while (!output().includes("Share your feedback")) {
      if (exitCode !== null) {
        throw new Error(`bun feedback exited early with code ${exitCode}. Output:\n${output()}`);
      }
      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for the feedback prompt. Output so far:\n${output()}`);
      }
      await new Promise<void>(resolve => {
        notifyData = resolve;
      });
    }

    for (const chunk of writes) {
      terminal.write(chunk);
    }

    const result = await Promise.race([messagePromise.then(message => ({ message })), exited.then(code => ({ code }))]);
    if (!("message" in result)) {
      throw new Error(`bun feedback exited with code ${result.code} without submitting. Output:\n${output()}`);
    }

    return { message: result.message, exitCode: await exited };
  }

  test("bracketed paste with CR newlines is inserted, not submitted", async () => {
    // Most terminals (iTerm2, Terminal.app, ...) send pasted newlines as \r.
    const { message, exitCode } = await runFeedbackWithTerminalInput([
      "\x1b[200~first line\rsecond line\rthird line\x1b[201~",
      "\r",
    ]);
    expect(message).toBe(expected);
    expect(exitCode).toBe(0);
  });

  test("bracketed paste with LF newlines is inserted, not dropped", async () => {
    // xterm pastes the clipboard verbatim, so newlines arrive as \n.
    const { message, exitCode } = await runFeedbackWithTerminalInput([
      "\x1b[200~first line\nsecond line\nthird line\x1b[201~",
      "\r",
    ]);
    expect(message).toBe(expected);
    expect(exitCode).toBe(0);
  });

  test("bracketed paste with CRLF newlines counts each as one newline", async () => {
    // Windows clipboard content uses \r\n line endings.
    const { message, exitCode } = await runFeedbackWithTerminalInput([
      "\x1b[200~first line\r\nsecond line\r\nthird line\x1b[201~",
      "\r",
    ]);
    expect(message).toBe(expected);
    expect(exitCode).toBe(0);
  });

  test("pasted LF newlines without bracketed paste insert newlines", async () => {
    // Terminals without bracketed paste support deliver the pasted text as-is.
    const { message, exitCode } = await runFeedbackWithTerminalInput(["first line\nsecond line\nthird line", "\r"]);
    expect(message).toBe(expected);
    expect(exitCode).toBe(0);
  });

  test("typing and pressing Enter still submits", async () => {
    const { message, exitCode } = await runFeedbackWithTerminalInput(["hello world", "\r"]);
    expect(message).toBe("hello world");
    expect(exitCode).toBe(0);
  });
});
