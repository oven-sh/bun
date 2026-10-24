// Work that data from outside can cause: texts of JSON whose objects hold their names in every order, names nobody has seen, indexes far apart.
// Each form of work-that-data-causes/forms.js and typed-forms.ts runs on the same input compiled and in plain Bun. What is judged is the ratio of the two times and how the
// compiled time grows with the input, never seconds: a table that such data fills must not make the work quadratic.
import { afterAll, expect } from "bun:test";
import { bunExe, isASAN, isDebug, isLinux, isWindows, tempDir } from "harness";
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { beforeAll, describe, test } from "./supported";

const sources = ["forms.js", "typed-forms.ts"];
const inFolder = (source: string) => join(import.meta.dir, "work-that-data-causes", source);
const rows = sources.flatMap(source =>
  Bun.spawnSync([bunExe(), inFolder(source)])
    .stdout.toString()
    .trim()
    .split("\n")
    .map(name => [source, name]),
);
const few = 3_000;
const many = 30_000;
// Below this many milliseconds a time says more about the machine than about the work.
const floor = 40;

// A ratio of times says nothing where every load and store is checked.
describe.skipIf(isASAN || isDebug)("compile/aot/work that data causes", () => {
  const dir = tempDir("aot-work-that-data-causes", {});
  const cwd = String(dir);
  const compiled = (source: string) => join(cwd, source.replace(/\.\w+$/, isWindows ? ".exe" : ""));
  afterAll(() => dir[Symbol.dispose]());

  beforeAll(async () => {
    for (const source of sources) {
      copyFileSync(inFolder(source), join(cwd, source));
      const built = await run([bunExe(), "build", "--compile", "--aot", source, "--outfile", compiled(source)], cwd);
      expect(built.stderr).not.toContain("error:");
      expect(built.exitCode).toBe(0);
    }
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

  test.each(rows)(
    "%s: %s",
    async (source, name) => {
      const plain = await least([bunExe(), source, name, String(many)]);
      const small = await least([compiled(source), name, String(few)]);
      const large = await least([compiled(source), name, String(many)]);
      expect(large.answer).toBe(plain.answer);
      const timesPlainBun = Math.round(large.time / Math.max(plain.time, floor));
      // Ten times the input: linear work takes ten times as long, quadratic work a hundred times.
      const growth = Math.round(Math.max(large.time, floor) / Math.max(small.time, floor / 10));
      expect({ name, timesPlainBun: Math.max(timesPlainBun, 5), growth: Math.max(growth, 40) }).toEqual({
        name,
        timesPlainBun: 5,
        growth: 40,
      });
    },
    120_000,
  );

  test.skipIf(!isLinux)(
    "memory that is left when what was parsed is dropped: orders of the names of four record types",
    async () => {
      const source = "memory-left-behind.ts";
      copyFileSync(inFolder(source), join(cwd, source));
      const built = await run([bunExe(), "build", "--compile", "--aot", source, "--outfile", compiled(source)], cwd);
      expect(built.stderr).not.toContain("error:");
      expect(built.exitCode).toBe(0);
      const left = async (cmd: string[]) => {
        const ran = await run(cmd, cwd);
        expect({ cmd, stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({ cmd, stderr: "", exitCode: 0 });
        const [megabytes, answer] = ran.stdout.trim().split(" ");
        return { megabytes: Number(megabytes), answer };
      };
      const plain = await left([bunExe(), source, "40000"]);
      const ours = await left([compiled(source), "40000"]);
      expect(ours.answer).toBe(plain.answer);
      const timesPlainBun = Math.round(ours.megabytes / Math.max(plain.megabytes, 10));
      expect({ timesPlainBun: Math.max(timesPlainBun, 3) }).toEqual({ timesPlainBun: 3 });
    },
    120_000,
  );
});
