import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned } from "./harness/commands";
import { describe, test } from "./supported";

const env = { ...bunEnv, NO_COLOR: "1" };

const program = `const input = process.stdin as any;
console.log("terminal", input.isTTY, "raw", input.isRaw);
console.log("set", input.setRawMode(true) === input, input.isRaw);
console.log("unset", input.setRawMode(false) === input, input.isRaw);
input.once("data", (chunk: Buffer) => {
  console.log("read", JSON.stringify(String(chunk)), input._handle.reading, input.bytesRead);
  input.pause();
  input.destroy();
});
console.log("ready");
`;

// Types one line once the program says that it reads.
async function shownInTerminal(cmd: string[], cwd: string) {
  let shown = "";
  let typed = false;
  const child = Bun.spawn({
    cmd,
    cwd,
    env,
    terminal: {
      cols: 80,
      rows: 24,
      data(terminal: Bun.Terminal, data: Uint8Array) {
        shown += new TextDecoder().decode(data);
        // The whole line: a line typed between "ready" and its newline is echoed in the middle of it.
        if (!typed && /ready\r?\n/.test(shown)) {
          typed = true;
          terminal.write("typed\n");
        }
      },
    },
  } as never);
  const exitCode = await child.exited;
  return { shown: shown.replaceAll("\r\n", "\n"), exitCode, signal: child.signalCode };
}

// Elsewhere than on Windows the native handle of the stream keeps the mode the terminal had before.
describe.skipIf(isWindows)("process.stdin.setRawMode() and a read in a terminal", () => {
  test(
    "answers as `bun run` does, validated",
    () =>
      slot(async () => {
        using dir = tempDir("aot-raw-mode", { "app.ts": program });
        const folder = String(dir);
        built(
          await spawned(
            [bunExe(), "build", "--compile", "--aot", "--aot-validate", "app.ts", "--outfile", "app"],
            folder,
            env,
          ),
        );

        const compiled = await shownInTerminal([join(folder, "app")], folder);
        expect(compiled).toEqual({
          // The terminal echoes what is typed.
          shown: 'terminal true raw false\nset true true\nunset true false\nready\ntyped\nread "typed\\n" true 6\n',
          exitCode: 0,
          signal: null,
        });
        expect(compiled).toEqual(await shownInTerminal([bunExe(), "app.ts"], folder));
      }),
    300_000,
  );
});
