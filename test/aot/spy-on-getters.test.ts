import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const reads = (form: string) => `export const read = () => ${form};\n`;
const spies = (made: string) => `import { spyOn, test } from "bun:test";
import { read } from "./lib.js";
test("a", () => {
  const before = read();
  let spy;
  try {
    spy = ${made}.mockReturnValue("spied");
  } catch (error) {
    console.log("SEEN", error.name, error.message.split(" because ")[0]);
    return;
  }
  console.log("SEEN", before, read());
});
`;
const next = `import { test } from "bun:test";\nimport { read } from "./lib.js";\ntest("b", () => { console.log("SEEN", read()); });\n`;
const unreadable = (...parts: string[]) => `(process.env.NO_SUCH_NAME ?? ${JSON.stringify(parts)}.join(""))`;

const getters: [made: string, read: string, value: string][] = [
  [`spyOn(Response.prototype, "status", "get")`, `new Response(null, { status: 201 }).status`, "201"],
  [`spyOn(Response.prototype, "ok", "get")`, `new Response(null).ok`, "true"],
  [`spyOn(Response.prototype, "bodyUsed", "get")`, `new Response(null).bodyUsed`, "false"],
  [`spyOn(Request.prototype, "url", "get")`, `new Request("http://a/").url`, "http://a/"],
  [`spyOn(Request.prototype, "method", "get")`, `new Request("http://a/").method`, "GET"],
  [`spyOn(Blob.prototype, "size", "get")`, `new Blob(["ab"]).size`, "2"],
  [`spyOn(Headers.prototype, "count", "get")`, `new Headers({ a: "1" }).count`, "1"],
  [`spyOn(TextDecoder.prototype, "encoding", "get")`, `new TextDecoder().encoding`, "utf-8"],
  [`spyOn(URL.prototype, "href", "get")`, `new URL("http://a/").href`, "http://a/"],
  [
    `spyOn(Response.prototype, ${unreadable("sta", "tus")}, "get")`,
    `new Response(null, { status: 201 }).status`,
    "201",
  ],
];
const refused: [made: string, read: string, value: string, said: string][] = [
  [
    `spyOn(globalThis[${unreadable("Bl", "ob")}].prototype, ${unreadable("si", "ze")}, "get")`,
    `new Blob(["ab"]).size`,
    "2",
    "Cannot spy on Blob.prototype.size",
  ],
  [`spyOn(Math, "PI", "get")`, `Math.PI`, String(Math.PI), "Cannot spy on Math.PI"],
  [`spyOn(globalThis, "Bun", "get")`, `typeof globalThis.Bun`, "object", "Cannot spy on Bun"],
];

async function runTests(directory: string, words: string | undefined, ...flags: string[]) {
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, exitCode } = await run([bunExe(), "test", ...flags, "./a.test.js", "./b.test.js"], directory, env);
  return { seen: stdout.split("\n").filter(line => line.startsWith("SEEN")), exitCode };
}

const files = (made: string, read: string) => ({
  "package.json": `{ "name": "p", "type": "module" }`,
  "lib.js": reads(read),
  "a.test.js": spies(made),
  "b.test.js": next,
});

test.concurrent.each(getters)(
  "a compiled file sees the spy, and the next file the getter: %s",
  async (made, read, value) => {
    using dir = tempDir("aot-spy-on-getters", files(made, read));
    const [plain, oneProgram, layers] = await Promise.all([
      runTests(String(dir), undefined),
      runTests(String(dir), undefined, "--aot"),
      runTests(String(dir), "TestRunLayers:2", "--aot"),
    ]);
    const expected = { seen: [`SEEN ${value} spied`, `SEEN ${value}`], exitCode: 0 };
    expect({ plain, oneProgram, layers }).toEqual({ plain: expected, oneProgram: expected, layers: expected });
  },
  240_000,
);

test.concurrent.each(refused)(
  "a spy that compiled code would not see is refused: %s",
  async (made, read, value, said) => {
    using dir = tempDir("aot-spy-on-getters", files(made, read));
    const [oneProgram, layers] = await Promise.all([
      runTests(String(dir), undefined, "--aot"),
      runTests(String(dir), "TestRunLayers:2", "--aot"),
    ]);
    const expected = { seen: [`SEEN TypeError ${said}`, `SEEN ${value}`], exitCode: 0 };
    expect({ oneProgram, layers }).toEqual({ oneProgram: expected, layers: expected });
  },
  240_000,
);
