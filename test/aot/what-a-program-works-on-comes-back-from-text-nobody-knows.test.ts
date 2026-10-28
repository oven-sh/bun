// fuzz/what-a-program-works-on-comes-back-from-text-nobody-knows.ts writes a program again so that what it works on has been handed to text that no build knows. Held to here: what each kind takes, what none takes,
// and that the program still does what it did, in plain Bun and compiled.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { Random } from "./fuzz/random";
import { laundered, whatIsLaundered, type WhatIsLaundered } from "./fuzz/what-a-program-works-on-comes-back-from-text-nobody-knows"; // prettier-ignore
import { test as testThatCompiles } from "./supported";

const text = `"use strict";
// A comment.
import { join } from "node:path";
class Box {
  n = 1;
  get() {
    return this.n;
  }
}
function twice(x) {
  return x * 2;
}
const o = { a: 1, m() { return this.a; }, "b c": [1, 2] };
const short = { twice };
console.debug = () => {};
o.a = 2;
console.log(o.m(), twice(o.a), new Box().get(), short.twice(3), o?.["b c"]?.length, join("x", "y"), typeof nothing, [3, 4].map(v => v + 1).join());
`;
// The seed under which every place of the kind is taken.
const all = (what: WhatIsLaundered, path = "main.mjs", given = text) => {
  for (let seed = 1; ; seed++) if (new Random(seed).chance(0.5)) return laundered(path, given, what, new Random(seed));
};
const lineOf = (written: string | undefined, begins: string) =>
  written!.split("\n").find(line => line.startsWith(begins));

// The line that prints, which may begin otherwise.
const printing = (what: WhatIsLaundered) =>
  all(what)!
    .split("\n")
    .find(line => line.includes("typeof nothing"));

test("each kind takes what it names", () => {
  expect(lineOf(all("objects"), "const o")).toBe(
    `const o = (launder({ a: 1, m() { return this.a; }, "b c": (launder([1, 2])) }));`,
  );
  expect(printing("objects")).toContain("(launder(new Box())).get()");
  expect(printing("functions")).toContain("(launder(twice))(o.a)");
  expect(printing("functions")).toContain(".map((launder(v => v + 1)))");
  expect(lineOf(all("functions"), "const short")).toBe("const short = { twice: (launder(twice)) };");
  expect(printing("classes")).toContain("new (launder(Box))().get()");
  expect(printing("receivers")).toContain("(launder(short)).twice(3)");
  expect(printing("arguments")).toContain("twice((launder(o.a)))");
  expect(printing("callees")).toContain('(launder(join))("x", "y")');
  expect(printing("results")).toContain("(launder(short.twice(3)))");
  expect(lineOf(all("keys"), "const o")).toBe(
    `const o = { [launderKey("a")]: 1, [launderKey("m")]() { return this[launderKey("a")]; }, [launderKey("b c")]: [1, 2] };`,
  );
  expect(lineOf(all("keys"), "o[")).toBe(`o[launderKey("a")] = 2;`);
});

test("the helpers stand behind the directives and the comments that a file begins with, and are typed in TypeScript", () => {
  expect(all("keys")!.split("\n").slice(0, 5)).toEqual([
    `"use strict";`,
    "// A comment.",
    `const launder = new Function("value", process.argv[9] ?? "return value");`,
    "const launderKey = launder;",
    `import { join } from "node:path";`,
  ]);
  expect(all("objects", "main.ts", "const list: number[] = [1];\nconsole.log(list);\n")).toBe(
    `const launder = new Function("value", process.argv[9] ?? "return value") as <V>(value: V) => V;\nconst list: number[] = (launder([1]));\nconsole.log(list);\n`,
  );
});

test("what an executable answers otherwise by design is not provoked", () => {
  for (const what of whatIsLaundered) {
    const written = all(what)!;
    // A method of the library is called under its name, a member that the file declares under a key.
    expect(written).toMatch(/\.join\(\)\)*;\n$/);
    // A store to a built-in object names the object and the member.
    expect(written).toContain("\nconsole.debug = ");
    expect(written).toContain("typeof nothing");
  }
  expect(printing("keys")).toContain(`o[launderKey("m")]()`);
  expect(
    laundered("main.mjs", "const launder = 1;\nconsole.log({ a: launder });\n", "everything", new Random(1)),
  ).toBeUndefined();
  expect(laundered("main.mjs", "console.log(1 + 2);\n", "classes", new Random(1))).toBeUndefined();
});

testThatCompiles.concurrent.each([...whatIsLaundered])(
  "with its %s laundered the program prints what it printed, plain and compiled",
  async what => {
    using folder = tempDir("aot-laundered", { "as-written.mjs": text, "main.mjs": all(what)! });
    const run = async (...cmd: string[]) => {
      await using process = Bun.spawn({ cmd, cwd: String(folder), env: bunEnv, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([
        process.stdout.text(),
        process.stderr.text(),
        process.exited,
      ]);
      return { stdout, stderr: exitCode ? stderr : "", exitCode };
    };
    const expected = { stdout: `2 4 1 6 2 ${join("x", "y")} undefined 4,5\n`, stderr: "", exitCode: 0 };
    expect(await run(bunExe(), "as-written.mjs")).toEqual(expected);
    expect(await run(bunExe(), "main.mjs")).toEqual(expected);
    const executable = join(String(folder), isWindows ? "program.exe" : "program");
    expect((await run(bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", executable)).exitCode).toBe(0);
    expect(await run(executable)).toEqual(expected);
  },
  300_000,
);
