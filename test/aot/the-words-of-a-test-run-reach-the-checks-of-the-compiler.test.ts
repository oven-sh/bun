// `bun test` takes no --aot-check. BUN_DEBUG_TEST_AOT_WORDS passes every option that is not the runner's own to the compiler, and `check=Validate` is such an option.
// So the build of a test run can be put under the compiler's own checks. A fault that a testing switch injects shows that the check is on:
// the compiler assumes that every index is in bounds of its array, nothing proves that it is, and the verifier fails the build. Without the check the fault goes unnoticed.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const files = {
  "position_test.ts": `import { expect, test } from "bun:test";
function id<T>(value: T): T { (globalThis as any).leaked = value; return (globalThis as any).leaked; }
function read(cells: number[], key: number): number { const at = key | 0; if (at < 0) return -1; return cells[at]! + 1; }
const cells = [0.5, 7.5, 2.5, 3.5];
test("reads", () => { expect(read(cells, id(1))).toBe(8.5); expect(read(cells, id(-3))).toBe(-1); });
`,
};
const lie = "testing=AssumeIndexesInBounds";

test.concurrent.each([
  ["", 0, "1 pass"],
  ["check=Validate", 0, "1 pass"],
  [lie, 0, "1 pass"],
  [`${lie},check=Validate`, 1, "an access is taken to lie inside its view and names no length"],
  ["check=Nonsense", 1, "unknown check Nonsense"],
])(
  "under %j",
  async (words, exitCode, said) => {
    using dir = tempDir("aot-words-of-a-test-run", files);
    const env = { ...bunEnv, NO_COLOR: "1", BUN_DEBUG_TEST_AOT_WORDS: words };
    const outcome = await run([bunExe(), "test", "--aot", "./position_test.ts"], String(dir), env);
    expect({ exitCode: outcome.exitCode, says: outcome.stderr.includes(said) }).toEqual({ exitCode, says: true });
  },
  120_000,
);
