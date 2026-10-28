import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "path";
import { built, slot, spawned } from "./run-programs";
import { describe, test } from "./supported";

const env = { ...bunEnv, NO_COLOR: "1" };

const program = `const input = process.stdin as any;
console.log("terminal", input.isTTY, "raw", input.isRaw);
console.log("set", input.setRawMode(true) === input, input.isRaw);
console.log("unset", input.setRawMode(false) === input, input.isRaw);
`;

async function shownInTerminal(cmd: string[], cwd: string) {
  let shown = "";
  const child = Bun.spawn({
    cmd,
    cwd,
    env,
    terminal: {
      cols: 80,
      rows: 24,
      data: (_: unknown, data: Uint8Array) => void (shown += new TextDecoder().decode(data)),
    },
  } as never);
  const exitCode = await child.exited;
  return { shown: shown.replaceAll("\r\n", "\n"), exitCode, signal: child.signalCode };
}

// Elsewhere than on Windows the mode the terminal had before is kept in the bytes of a typed array that native code writes.
describe.skipIf(isWindows)("process.stdin.setRawMode() in a terminal", () => {
  for (const flags of [[], ["--aot-validate"]]) {
    test(
      `answers as \`bun run\` does${flags.length ? ", validated" : ""}`,
      () =>
        slot(async () => {
          using dir = tempDir("aot-raw-mode", { "app.ts": program });
          const folder = String(dir);
          built(
            await spawned(
              [bunExe(), "build", "--compile", "--aot", ...flags, "app.ts", "--outfile", "app"],
              folder,
              env,
            ),
          );

          const compiled = await shownInTerminal([join(folder, "app")], folder);
          expect(compiled).toEqual({
            shown: "terminal true raw false\nset true true\nunset true false\n",
            exitCode: 0,
            signal: null,
          });
          expect(compiled).toEqual(await shownInTerminal([bunExe(), "app.ts"], folder));
        }),
      300_000,
    );
  }
});
