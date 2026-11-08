// vi.stubGlobal() defines a name on the global object, and a compiled file of the project reads it. A build used to answer such a read with "no such global".
// What a build learns holds for the whole program. So every form stubs a name of its own, NAME below, and forms share a project only where each of them still
// failed there on a Bun from before its own fix: a name that no build can read, a chain and a copy of the runner's object hide the faults of the others.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { describe, test } from "./supported";

type Form = [name: string, read: string, stub: string, seen: string];

const constant = `vi.stubGlobal("NAME", "stubbed")`;
const asType = "undefined string undefined";
const asValue = "undefined stubbed undefined";

const projects: Record<string, Form[]> = {
  "every name is written": [
    ["typeof name", "typeof NAME", constant, asType],
    ["globalThis.name", "globalThis.NAME", constant, asValue],
    ["typeof globalThis.name", "typeof globalThis.NAME", constant, asType],
    ["through a local and ?.", `global?.NAME !== undefined ? "there" : "none"`, constant, "none there none"],
    [
      "a function is called",
      `typeof NAME === "function" ? NAME() : "none"`,
      `vi.stubGlobal("NAME", () => "called")`,
      "none called none",
    ],
    [
      "a class is constructed",
      `typeof NAME === "function" ? new NAME().m() : "none"`,
      `vi.stubGlobal("NAME", class { m() { return "made"; } })`,
      "none made none",
    ],
    [
      "typeof window",
      `typeof window !== "undefined" && typeof window.document !== "undefined" ? window.document.title : "none"`,
      `vi.stubGlobal("window", { document: { title: "stubbed" } })`,
      "none stubbed none",
    ],
    ["the function handed on", "typeof NAME", `const run = f => f("NAME", "stubbed"); run(vi.stubGlobal)`, asType],
    ["the function handed into another file", "typeof stubbedByTheHelper", `call(vi.stubGlobal)`, asType],
    ["the function out of a list", "typeof NAME", `[vi.stubGlobal][0]("NAME", "stubbed")`, asType],
    [
      "the function kept in an object",
      "globalThis.NAME",
      `const held = { stub: vi.stubGlobal }; held.stub("NAME", "stubbed")`,
      asValue,
    ],
    [
      "the function called with a third operand",
      "typeof NAME",
      `class Kept { static stub = vi.stubGlobal; } Kept.stub("NAME", "stubbed", { a: 1 })`,
      asType,
    ],
  ],
  "a name that the build can't read": [
    [
      "joined",
      "typeof someGlobal",
      `vi.stubGlobal(process.env.NO_SUCH_NAME ?? ["some", "Global"].join(""), "stubbed")`,
      asType,
    ],
  ],
  "behind a chain of the runner's calls": [
    ["a chain from stubEnv", "typeof NAME", `vi.stubEnv("SOME_NAME", "1").stubGlobal("NAME", "stubbed")`, asType],
    [
      "a chain from useFakeTimers",
      "globalThis.NAME",
      `vi.useFakeTimers().stubGlobal("NAME", "stubbed"); vi.useRealTimers()`,
      asValue,
    ],
    ["a chain from clearAllMocks", "typeof NAME", `vi.clearAllMocks().stubGlobal("NAME", "stubbed")`, asType],
  ],
  "a copy of the runner's object": [
    ["stubs a built-in", "typeof atob", `({ ...vi }).stubGlobal("atob", 1)`, "function number function"],
  ],
};

function filesOf(forms: Form[]) {
  const named = forms.map(([name, ...texts], i) => [
    name,
    ...texts.map(text => text.replaceAll("NAME", `someGlobal${i}`)),
  ]);
  const table = (column: number, body: (text: string) => string) =>
    named.map(form => `  ${JSON.stringify(form[0])}: () => ${body(form[column])},\n`).join("");
  return {
    "package.json": `{ "name": "p", "type": "module" }`,
    "lib.js": `const global = globalThis;\nexport const reads = {\n${table(1, read => `(${read})`)}};\n`,
    "helper.js": `export const call = f => f("stubbedByTheHelper", "stubbed");\n`,
    "a.test.js": `import { test, vi } from "bun:test";
import { call } from "./helper.js";
import { reads } from "./lib.js";
const stubs = {
${table(2, stub => `{ ${stub}; }`)}};
test("t", () => {
  for (const name in stubs) {
    const before = reads[name]();
    stubs[name]();
    const stubbed = reads[name]();
    vi.unstubAllGlobals();
    console.log("SEEN", name + ":", before, stubbed, reads[name]());
  }
  vi.unstubAllEnvs();
});
`,
  };
}

async function runTests(directory: string, ...flags: string[]) {
  const { stdout, exitCode } = await run([bunExe(), "test", ...flags], directory, bunEnv);
  return { seen: stdout.split("\n").filter(line => line.startsWith("SEEN")), exitCode };
}

describe.each(Object.keys(projects))("a compiled file sees a stubbed global: %s", project => {
  let ran: Promise<Awaited<ReturnType<typeof runTests>>[]> | undefined;
  async function both() {
    using dir = tempDir("aot-stub-global", filesOf(projects[project]));
    return await Promise.all([runTests(String(dir)), runTests(String(dir), "--aot")]);
  }

  test.each(projects[project])(
    "%s",
    async (name, read, stub, seen) => {
      const [plain, oneProgram] = await (ran ??= both());
      const ofThisForm = ({ seen, exitCode }: typeof plain) => ({
        seen: seen.filter(line => line.startsWith(`SEEN ${name}:`)),
        exitCode,
      });
      const expected = { seen: [`SEEN ${name}: ${seen}`], exitCode: 0 };
      expect({ plain: ofThisForm(plain), oneProgram: ofThisForm(oneProgram) }).toEqual({
        plain: expected,
        oneProgram: expected,
      });
    },
    240_000,
  );
});
