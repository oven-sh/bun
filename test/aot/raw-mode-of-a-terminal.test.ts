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
`;

type Resize = [after: string, cols: number, rows: number];

async function shownInTerminal(cmd: string[], cwd: string, resizes: Resize[] = []) {
  let shown = "";
  const left = [...resizes];
  const child = Bun.spawn({
    cmd,
    cwd,
    env,
    terminal: {
      cols: 80,
      rows: 24,
      data: (terminal: { resize(cols: number, rows: number): void }, data: Uint8Array) => {
        shown += new TextDecoder().decode(data);
        while (left.length > 0 && shown.includes(left[0][0])) {
          const [, cols, rows] = left.shift()!;
          terminal.resize(cols, rows);
        }
      },
    },
  } as never);
  const exitCode = await child.exited;
  return { shown: shown.replaceAll("\r\n", "\n"), exitCode, signal: child.signalCode };
}

// The stream's own listener stands behind this one, so each read finds the size from before the resize that is being told of.
const programThatListensFirst = `const sizes: string[] = [];
process.on("SIGWINCH", () => {
  sizes.push(process.stdout.columns + "x" + process.stdout.rows);
  // The next resize comes when the stream has read this one.
  setImmediate(() => {
    console.log("resized", sizes.length);
    if (sizes.length < 3) return;
    console.log(sizes.join(" "));
    process.exit(0);
  });
});
setInterval(() => {}, 1000);
console.log("ready");
`;

describe.skipIf(isWindows)(
  "process.stdout.columns in a listener for SIGWINCH that was added before the stream was read",
  () => {
    test(
      "answers as `bun run` does",
      () =>
        slot(async () => {
          using dir = tempDir("aot-size-of-terminal", { "app.ts": programThatListensFirst });
          const folder = String(dir);
          built(await spawned([bunExe(), "build", "--compile", "--aot", "app.ts", "--outfile", "app"], folder, env));

          const resizes: Resize[] = [
            ["ready", 90, 20],
            ["resized 1", 91, 21],
            ["resized 2", 92, 22],
          ];
          const compiled = await shownInTerminal([join(folder, "app")], folder, resizes);
          expect(compiled).toEqual({
            shown: "ready\nresized 1\nresized 2\nresized 3\n90x20 90x20 91x21\n",
            exitCode: 0,
            signal: null,
          });
          expect(compiled).toEqual(await shownInTerminal([bunExe(), "app.ts"], folder, resizes));
        }),
      300_000,
    );
  },
);

// Elsewhere than on Windows the mode the terminal had before is kept in the bytes of a typed array that native code writes.
describe.skipIf(isWindows)("process.stdin.setRawMode() in a terminal", () => {
  test(
    "answers as `bun run` does",
    () =>
      slot(async () => {
        using dir = tempDir("aot-raw-mode", { "app.ts": program });
        const folder = String(dir);
        built(await spawned([bunExe(), "build", "--compile", "--aot", "app.ts", "--outfile", "app"], folder, env));

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
});
