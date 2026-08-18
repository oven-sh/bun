import { spawn } from "bun";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, withoutAggressiveGC } from "harness";
import { join } from "path";

const arg0 = process.argv[0];
const arg1 = join(import.meta.dir, "print-process-args.js");

async function run(args, isRun) {
  const exe = bunExe();

  const { stdout } = spawn([exe, ...(isRun ? ["run"] : []), arg1, ...args], {
    cwd: import.meta.dir,
    stderr: "inherit",
    stdin: "ignore",
    env: bunEnv,
  });
  return await new Response(stdout).json();
}
test("args exclude run", async () => {
  const fixture = [["-"], ["a"], ["a", "b"], ["a", "b", "c"], []];

  for (let i = 0; i < 10; i++) {
    const withRun = fixture.map(args => run(args, true));
    const withoutRun = fixture.map(args => run(args, false));

    const all = await Promise.all([...withRun, ...withoutRun]);
    withoutAggressiveGC(() => {
      for (let i = 0; i < fixture.length; i++) {
        expect(all[i]).toEqual([arg0, arg1, ...fixture[i]]);
      }
    });
    console.count("Run");
  }
});

// Non-ASCII and quoting edge cases must survive the command line round trip
// (https://github.com/oven-sh/bun/issues/11610). On Windows this is where the
// UTF-16 command line gets split and converted.
test("args round-trip non-ASCII, spaces, quotes and backslashes", async () => {
  const args = ["🌊 测试", "a b", 'q"uote', "back\\slash\\", "trail\\\\", "", "--", "-e", "äöü"];
  const [plain, withRun] = await Promise.all([run(args, false), run(args, true)]);
  expect(plain).toEqual([arg0, arg1, ...args]);
  expect(withRun).toEqual([arg0, arg1, ...args]);
});
