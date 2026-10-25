// The helper behind JSON.parse<T>(text) and validate<T>(value) is part of a bundle only when the bundle holds such a call.
// A bundle without one is what it would be if the helper did not exist: the helper's own names and the globals it uses reserve nothing.
import { expect, test } from "bun:test";
import { bunExe, tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { run as runCommand } from "../aot/harness/run";

// Today only an ahead-of-time build makes the checks: a bundle has no validators yet, and there "bun:bundle" has no export named `validate`.
// What a bundle with such a call is to hold stands here as todo.
const whereNothingIsCompiled = test.todoIf(true);

async function run(cmd: string[], cwd: string): Promise<string> {
  const { stdout, stderr, exitCode } = await runCommand(cmd, cwd);
  expect({ stderr: exitCode ? stderr : "", exitCode }).toEqual({ stderr: "", exitCode: 0 });
  return stdout;
}

function writtenIn(dir: string): string[] {
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter(name => name.endsWith(".js"))
    .sort()
    .map(name => readFileSync(join(dir, name), "utf8"));
}

const timesHeld = (texts: string[], part: string) => texts.reduce((sum, text) => sum + text.split(part).length - 1, 0);

const partOfTheHelper = "Invalid input";
const globalsOfTheHelper = ["Array", "Map", "Number", "RegExp", "Set", "URL"];
const namesOfTheHelper = ["isObject", "isPlainObject", "report", "build", "copyOf", "define", "add", "holds"];
const names = [...globalsOfTheHelper, ...namesOfTheHelper];

const declaresTheNames =
  names.map((name, at) => `var ${name} = ${at};\n`).join("") +
  `export { ${names.join(", ")} };\nexport * as all from "./other";\n`;

const user = `export interface User { id: number }\n`;
const parses = (label: string) =>
  `import { JSON } from "bun"; import { validate } from "bun:bundle";
import type { User } from "./user";
try {
  console.log("${label}", JSON.parse<User>('{"id":1}').id, validate<User>({ id: 2 }).id);
  JSON.parse<User>('{"id":"one"}');
} catch (error: any) {
  console.log("${label}", error.message);
}
`;
const printedBy = (label: string) => `${label} 1 2\n${label} id must be number, received string\n`;

const formats = [
  ["bun", "esm"],
  ["bun", "cjs"],
  ["node", "esm"],
  ["node", "cjs"],
  ["browser", "esm"],
  ["browser", "iife"],
];

test.each(formats)(
  "without a validating call, --target=%s --format=%s renames nothing and holds nothing of the helper",
  async (target, format) => {
    using dir = tempDir("validation-helper-not-called", {
      "program.ts": declaresTheNames,
      "other.ts": `export const one = 1;\n`,
    });
    await run(
      [bunExe(), "build", "--target=" + target, "--format=" + format, "./program.ts", "--outdir=out"],
      String(dir),
    );
    const [bundle] = writtenIn(join(String(dir), "out"));
    expect(bundle).toContain("__export");
    for (const [at, name] of names.entries()) expect(bundle).toContain(`var ${name} = ${at};`);
    expect(bundle).not.toMatch(new RegExp(`\\b(${names.join("|")})\\d`));
    expect(bundle).not.toContain(partOfTheHelper);
    expect(bundle).not.toContain("__validate");
  },
);

whereNothingIsCompiled.each(formats)(
  "with a validating call, --target=%s --format=%s holds the helper once",
  async (target, format) => {
    using dir = tempDir("validation-helper-called", { "user.ts": user, "program.ts": parses("program") });
    await run(
      [bunExe(), "build", "--target=" + target, "--format=" + format, "./program.ts", "--outdir=out"],
      String(dir),
    );
    const written = writtenIn(join(String(dir), "out"));
    expect(written.length).toBe(1);
    expect(timesHeld(written, "var __validate = ") + timesHeld(written, "function __validate(")).toBe(1);
    expect(await run([bunExe(), "run", "./out/program.js"], String(dir))).toBe(printedBy("program"));
  },
);

whereNothingIsCompiled("the call may be in the last of many files", async () => {
  const files: Record<string, string> = { "user.ts": user, "last.ts": parses("last") };
  let program = "";
  for (let at = 0; at < 40; at++) {
    files[`plain${at}.ts`] = `export const value${at} = ${at};\n`;
    program += `import { value${at} } from "./plain${at}";\n`;
  }
  files["program.ts"] =
    program + `import "./last";\nconsole.log(${Array.from({ length: 40 }, (_, at) => "value" + at).join(" + ")});\n`;
  using dir = tempDir("validation-helper-last-file", files);
  await run([bunExe(), "build", "--target=bun", "./program.ts", "--outdir=out"], String(dir));
  expect(await run([bunExe(), "run", "./out/program.js"], String(dir))).toBe(printedBy("last") + "780\n");
});

whereNothingIsCompiled("two entry points each hold the helper once", async () => {
  using dir = tempDir("validation-helper-two-entry-points", {
    "user.ts": user,
    "first.ts": parses("first"),
    "second.ts": parses("second"),
    "third.ts": `console.log("third");\n`,
  });
  await run(
    [bunExe(), "build", "--target=bun", "./first.ts", "./second.ts", "./third.ts", "--outdir=out"],
    String(dir),
  );
  for (const name of ["first", "second"]) {
    const bundle = readFileSync(join(String(dir), "out", name + ".js"), "utf8");
    expect(timesHeld([bundle], "var __validate = ") + timesHeld([bundle], "function __validate(")).toBe(1);
    expect(await run([bunExe(), "run", `./out/${name}.js`], String(dir))).toBe(printedBy(name));
  }
  expect(readFileSync(join(String(dir), "out", "third.js"), "utf8")).not.toContain(partOfTheHelper);
});

whereNothingIsCompiled("with --splitting the helper is written once for all entry points", async () => {
  using dir = tempDir("validation-helper-splitting", {
    "user.ts": user,
    "first.ts": parses("first"),
    "second.ts": parses("second"),
  });
  await run(
    [bunExe(), "build", "--target=bun", "--splitting", "./first.ts", "./second.ts", "--outdir=out"],
    String(dir),
  );
  const written = writtenIn(join(String(dir), "out"));
  expect(timesHeld(written, "var __validate = ") + timesHeld(written, "function __validate(")).toBe(1);
  for (const name of ["first", "second"])
    expect(await run([bunExe(), "run", `./out/${name}.js`], String(dir))).toBe(printedBy(name));
});

whereNothingIsCompiled("Bun.build holds the helper only in the build that calls it", async () => {
  using dir = tempDir("validation-helper-bun-build", {
    "user.ts": user,
    "calls.ts": parses("calls"),
    "plain.ts": declaresTheNames,
    "other.ts": `export const one = 1;\n`,
    "build.ts": `for (const entry of ["./plain.ts", "./calls.ts", "./plain.ts"]) {
  const built = await Bun.build({ entrypoints: [entry], target: "bun" });
  const text = await built.outputs[0].text();
  console.log(entry, text.includes("Invalid input"), /\\b(Map|Set)\\d/.test(text));
}
`,
  });
  expect(await run([bunExe(), "run", "./build.ts"], String(dir))).toBe(
    "./plain.ts false false\n./calls.ts true false\n./plain.ts false false\n",
  );
});
