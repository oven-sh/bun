// A constant whose readers were all removed leaves nothing of its text in the executable, also where a function of another module read it, so that it was a variable and no folded constant.
import { afterAll, expect } from "bun:test";
import { readFileSync, rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { compileCommand } from "./harness/flags";
import { built, spawned, withoutDebugInformation } from "./run-programs";
import { beforeAll, describe, test } from "./supported";

const unread = "the text of a constant that nothing reads";
const read = "the text of a constant that is read";

describe("compile/aot/the text of a constant that nothing reads is not in the executable", () => {
  const root = String(tempDir("aot-text-nothing-reads", {}));
  const executable = join(root, isWindows ? "program.exe" : "program");
  afterAll(() => rmSync(root, { recursive: true, force: true }));

  beforeAll(async () => {
    writeFileSync(
      join(root, "texts.ts"),
      `export const UNREAD = \`${unread}\`;
export const READ = \`${read}\`;
export function withUnread(text: string = UNREAD): string { return text + "!"; }
export function withRead(text: string = READ): string { return text + "!"; }
export const lengths = UNREAD.length + READ.length + process.argv.length;
`,
    );
    writeFileSync(
      join(root, "main.ts"),
      `import { feature } from "bun:bundle";
import { UNREAD, lengths, withRead, withUnread } from "./texts";
if (feature("WITHOUT_IT")) console.log(withRead());
else console.log(UNREAD, withUnread(), lengths);
`,
    );
    built(
      await spawned(
        [
          bunExe(),
          ...compileCommand,
          ...withoutDebugInformation(),
          "--feature=WITHOUT_IT",
          "./main.ts",
          "--outfile",
          executable,
        ],
        root,
        bunEnv,
      ),
    );
  }, 300_000);

  test("its bytes hold the text that is read and not the other", () => {
    const bytes = readFileSync(executable);
    expect({ read: bytes.includes(read), unread: bytes.includes(unread) }).toEqual({ read: true, unread: false });
  });

  test("it runs", async () => {
    const run = await spawned([executable], root, bunEnv);
    expect({ stdout: run.stdout, exitCode: run.exitCode }).toEqual({ stdout: read + "!\n", exitCode: 0 });
  });
});
