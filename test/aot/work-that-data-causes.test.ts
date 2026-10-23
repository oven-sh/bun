// Work that data from outside can cause: texts of JSON whose objects hold their names in every order, names nobody has seen, indexes far apart.
// Each form of work-that-data-causes/forms.js runs on the same input compiled and in plain Bun. What is judged is the ratio of the two times and how the
// compiled time grows with the input, never seconds: a table that such data fills must not make the work quadratic.
import { afterAll, expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { beforeAll, describe, test } from "./supported";

const source = join(import.meta.dir, "work-that-data-causes", "forms.js");
const names = Bun.spawnSync([bunExe(), source]).stdout.toString().trim().split("\n");
const few = 3_000;
const many = 30_000;
// Below this many milliseconds a time says more about the machine than about the work.
const floor = 40;

describe("compile/aot/work that data causes", () => {
  const dir = tempDir("aot-work-that-data-causes", {});
  const cwd = String(dir);
  const compiled = join(cwd, "forms");
  afterAll(() => dir[Symbol.dispose]());

  beforeAll(async () => {
    copyFileSync(source, join(cwd, "forms.js"));
    const built = await run([bunExe(), "build", "--compile", "--aot", "forms.js", "--outfile", "forms"], cwd);
    expect(built.stderr).not.toContain("error:");
    expect(built.exitCode).toBe(0);
  });

  async function least(cmd: string[]) {
    let time = Infinity;
    let answer = "";
    for (let turn = 0; turn < 2; turn++) {
      const ran = await run(cmd, cwd);
      expect({ cmd, stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({ cmd, stderr: "", exitCode: 0 });
      const [milliseconds, ...rest] = ran.stdout.trim().split(" ");
      time = Math.min(time, Number(milliseconds));
      answer = rest.join(" ");
    }
    return { time, answer };
  }

  test.each(names)(
    "%s",
    async name => {
      const plain = await least([bunExe(), "forms.js", name, String(many)]);
      const small = await least([compiled, name, String(few)]);
      const large = await least([compiled, name, String(many)]);
      expect(large.answer).toBe(plain.answer);
      const timesPlainBun = Math.round(large.time / Math.max(plain.time, floor));
      // Ten times the input: linear work takes ten times as long, quadratic work a hundred times.
      const growth = Math.round(Math.max(large.time, floor) / Math.max(small.time, floor / 10));
      expect({ name, timesPlainBun: Math.max(timesPlainBun, 5), growth: Math.max(growth, 30) }).toEqual({
        name,
        timesPlainBun: 5,
        growth: 30,
      });
    },
    120_000,
  );
});
