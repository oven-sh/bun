// A compiled test run keeps no text: the message of a TypeError quotes what failed out of the file. Some forms are found by passing over the text in front of them, because
// a quote or a regular expression there may hold what looks like code. Where a minifier has left a whole function in one line, that was all of the line, once for each place.
//
// What is quoted is an expression, and no expression holds a `;` or a brace of the block it stands in. So a long line is passed over once, and each place is looked for
// between the two marks around it. Here forty places of each form fail once each, in one function: in many lines, and in one line. Every message is what `bun run` says.
//
// The program measures itself with process.cpuUsage(), as the-first-error-at-a-place-costs-the-same-in-a-longer-file.test.ts does.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { spawned } from "./harness/commands";
import { describe, test } from "./measures";

const places = 40;
const fillers = 20_000;
const forms: Record<string, (step: number) => string> = {
  "a name is read": step => `none.a${step}`,
  "a name is called": step => `held.f${step}()`,
  "an element is read": step => `none[held.k${step}]`,
  "a key is asked for": step => `"k${step}" in none`,
  "a name is deleted": step => `delete none.d${step}`,
  "an element is called": step => `held[held.k + ${step}](1)`,
  "an element is read behind quoted text": step => `held.t = "';{" + /[;'"{]/.source, none[held.q${step}]`,
  "an element is read in a function in a call": step => `held.run(function () { return none[held.i${step}]; })`,
};

function program(separator: string) {
  const cases: string[] = [];
  for (let step = 0; step < fillers; step++) cases.push(`case ${step}: held.x = held.x + ${step}; break;`);
  const firstOf: Record<string, number> = {};
  let step = fillers;
  for (const [name, form] of Object.entries(forms)) {
    firstOf[name] = step;
    for (let place = 0; place < places; place++) cases.push(`case ${step}: ${form(step++)}; break;`);
  }
  return [
    `var none = globalThis.nothingHere, held = { x: 0, k: "k", run(f) { return f(); } }, spent = {}, messages = [];`,
    `function go(step) {`,
    `switch (step) {`,
    ...cases,
    `}`,
    `}`,
    `for (const [name, first] of Object.entries(${JSON.stringify(firstOf)})) {`,
    `const start = process.cpuUsage();`,
    `for (let step = first; step < first + ${places}; step++) {`,
    `try { go(step); } catch (error) { messages.push(error.message); }`,
    `}`,
    `const used = process.cpuUsage(start);`,
    `spent[name] = (used.user + used.system) / 1000;`,
    `}`,
    `console.log(JSON.stringify({ messages, spent }));`,
  ].join(separator);
}

type Measured = { messages: string[]; spent: Record<string, number> };
const runs = (name: string) =>
  `import { test } from "bun:test";\ntest("runs", async () => {\n  await import("./${name}.js");\n});\n`;
const dir = tempDir("aot-first-error-of-every-form", {
  "in-lines.js": program("\n"),
  "in-one-line.js": program(""),
  "in-lines.test.js": runs("in-lines"),
  "in-one-line.test.js": runs("in-one-line"),
});
const folder = String(dir);

const whenMeasured: Record<string, Promise<Measured>> = {};
const measure = (name: string) =>
  (whenMeasured[name] ??= (async () => {
    const ran = await spawned([bunExe(), "test", "--aot", `./${name}.test.js`], folder, bunEnv, 400_000);
    const printed = ran.stdout.split("\n").find(line => line.startsWith(`{"messages"`));
    expect({ printed: printed !== undefined, stderr: printed ? "" : ran.stderr, exitCode: ran.exitCode }).toEqual({
      printed: true,
      stderr: "",
      exitCode: 0,
    });
    return JSON.parse(printed!) as Measured;
  })());

describe.concurrent("the first error of every form in one long line of a compiled test run", () => {
  test("every message is what bun run says", async () => {
    const plain = await spawned([bunExe(), "./in-one-line.js"], folder, bunEnv, 200_000);
    expect({ stderr: plain.stderr, exitCode: plain.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect((await measure("in-one-line")).messages).toEqual((JSON.parse(plain.stdout) as Measured).messages);
  }, 480_000);

  for (const form of Object.keys(forms)) {
    test(
      form,
      async () => {
        const [inLines, inOneLine] = await Promise.all([measure("in-lines"), measure("in-one-line")]);
        console.error(
          `FIRST ERRORS, ${form}: ${inLines.spent[form].toFixed(2)} ms for ${places} places in lines | ${inOneLine.spent[form].toFixed(2)} ms in one line`,
        );
        expect(inOneLine.spent[form]).toBeLessThan(3 * inLines.spent[form] + 25);
      },
      480_000,
    );
  }
});
