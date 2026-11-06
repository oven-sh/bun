// Work that data from outside can cause: texts of JSON whose objects hold their names in every order, names nobody has seen, indexes far apart.
// Each form of work-that-data-causes/forms.js and typed-forms.ts answers on the same input as it does in plain Bun.
// A table that such data fills must not make the work quadratic: the forms that once were run on an input on which quadratic work does not end in time.
import { afterAll, expect } from "bun:test";
import { bunExe, isASAN, isDebug, isLinux, isWindows, tempDir } from "harness";
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { measureUntilWithinBounds } from "./harness/measure-again";
import { run } from "./harness/run";
import { beforeAll, describe, test } from "./supported";

const sources = ["forms.js", "typed-forms.ts"];
const inFolder = (source: string) => join(import.meta.dir, "work-that-data-causes", source);

describe("compile/aot/work that data causes", () => {
  const dir = tempDir("aot-work-that-data-causes", {});
  const cwd = String(dir);
  const compiled = (source: string) => join(cwd, source.replace(/\.\w+$/, isWindows ? ".exe" : ""));
  afterAll(() => dir[Symbol.dispose]());

  async function build(source: string) {
    copyFileSync(inFolder(source), join(cwd, source));
    const built = await run([bunExe(), "build", "--compile", "--aot", source, "--outfile", compiled(source)], cwd);
    expect(built.stderr).not.toContain("error:");
    expect(built.exitCode).toBe(0);
  }
  beforeAll(() => Promise.all(sources.map(build)));

  async function printed(cmd: string[]) {
    const ran = await run(cmd, cwd);
    expect({ cmd, stderr: ran.stderr, exitCode: ran.exitCode }).toEqual({ cmd, stderr: "", exitCode: 0 });
    return ran.stdout;
  }

  test.concurrent.each(sources)("%s: every form answers as in plain Bun", async source => {
    const [ours, plain] = await Promise.all(
      [[compiled(source)], [bunExe(), source]].map(cmd => printed([...cmd, "every form", "3000"])),
    );
    expect(ours).toBe(plain);
  });

  // 640,000 names take about a second. Where each store walked what had been read before, they took minutes.
  test.concurrent
    .skipIf(isASAN || isDebug)
    .each([
      "names stored on an object that has heirs, read through an heir",
      "names stored on an object that has heirs, other names asked of an heir",
      "names read through an heir, then deleted from the object it inherits from",
      "Object.assign onto an object that has heirs",
      "methods added to a prototype while instances call them",
    ])("forms.js: %s", async name => void (await printed([compiled("forms.js"), name, "160000"])), 60_000);

  test.skipIf(!isLinux || isASAN || isDebug)(
    "memory that is left when what was parsed is dropped: orders of the names of four record types",
    async () => {
      const source = "memory-left-behind.ts";
      await build(source);
      const left = async (cmd: string[]) => {
        const [megabytes, answer] = (await printed(cmd)).trim().split(" ");
        return { megabytes: Number(megabytes), answer };
      };
      const timesPlainBun = await measureUntilWithinBounds(
        source,
        async () => {
          const plain = await left([bunExe(), source, "40000"]);
          const ours = await left([compiled(source), "40000"]);
          expect(ours.answer).toBe(plain.answer);
          return Math.round(ours.megabytes / Math.max(plain.megabytes, 10));
        },
        times => times <= 3,
      );
      expect({ timesPlainBun: Math.max(timesPlainBun, 3) }).toEqual({ timesPlainBun: 3 });
    },
    120_000,
  );
});
