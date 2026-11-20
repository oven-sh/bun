import { afterAll, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { endChildren, longLimit, spawn } from "../children";

afterAll(endChildren);

const tsconfig = JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [] }, include: ["*.ts"] });
const names = ["Barrel", "Candle", "Dagger", "Ember", "Fiddle", "Goblet", "Hammer", "Icicle", "Jacket"];

// `held` is a union that has one class more at each statement, and a method is called on it after each.
const program = (last: string, members: string) =>
  [
    "export {};",
    ...names.map((name, index) => `class ${name} { weigh() { return ${index}; } }`),
    `class ${last} { ${members} }`,
    "function f(n: number) {",
    "  let held = null;",
    ...names.map((name, index) => `  if (n > ${index}) held = new ${name}();\n  held!.weigh();`),
    `  if (n > 99) held = new ${last}();`,
    "  const probe: never = held!.weigh();",
    "}",
  ].join("\n") + "\n";

async function check(source: string) {
  using dir = tempDir("check-property-of-a-union-that-grows", { "tsconfig.json": tsconfig, "a.ts": source });
  await using proc = spawn({
    cmd: [bunExe(), "check", "--no-pretty"],
    cwd: String(dir),
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text()]);
  return stdout + stderr;
}

const typeOfProbe = async (source: string) =>
  /Type '(.*)' is not assignable to type 'never'/.exec(await check(source))?.[1];

// A member that is out of reach is a part of the property of a union only where the members have it from one declaration.
test.concurrent.each([
  ["protected", "TS2445"],
  ["private", "TS2341"],
])(
  "a %s method of a generic class is out of reach on a union of classes that instantiate the class apart",
  async (reach, code) => {
    const source = [
      "export {};",
      `class Scale<T> { ${reach} weigh(): T { return undefined as T; } }`,
      ...names.map((name, index) => `class ${name} extends Scale<${index % 2 ? "number" : "string"}> {}`),
      "function f(n: number) {",
      "  let held = null;",
      ...names.map((name, index) => `  if (n > ${index}) held = new ${name}(); held!.weigh();`),
      "}",
    ];
    const calls = source.flatMap((line, index) => (line.includes("held!.weigh()") ? [`${index + 1}: ${code}`] : []));
    const errors = (await check(source.join("\n") + "\n")).matchAll(/^a\.ts\((\d+),\d+\): error (TS\d+)/gm);
    expect(Array.from(errors, ([, line, error]) => `${line}: ${error}`)).toEqual(calls);
  },
  longLimit,
);

// The property of such a union is made of the property of the union before and of the new member. A member that lacks the
// name and has an index signature comes last among the parts of the property, wherever its name puts it among the members.
test.concurrent.each(["Anchor", "Fig", "Zipper"])(
  "%s, a class with an index signature, joins classes with a method",
  async last => {
    expect(await typeOfProbe(program(last, "[key: string]: any;"))).toBe("any");
    expect(await typeOfProbe(program(last, "[key: string]: () => string;"))).toBe("string | number");
    expect(await typeOfProbe(program(last, 'weigh() { return "text"; }'))).toBe("string | number");
  },
  longLimit,
);
