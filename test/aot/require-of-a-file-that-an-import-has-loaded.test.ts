import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `bun test` reads a file of a kind that nothing names, `a.png`, as code for require(), and an import of it gets its path. The loader has one place for the
// path, so what an import has loaded answers a later require(), with the namespace object. A compiled run read the file as code whatever had been imported,
// and by a name that the build cannot know it answered the path whatever had not.
const picture = "\x89PNG\r\n\x1a\n not code (";
const code = "module.exports = 7;\n";

const body = (at: (name: string) => string, first: string) => `import { expect, test } from "bun:test";
import picture from "./src/${first}1.png";
const shown = value =>
  JSON.stringify(
    value && typeof value === "object" && "default" in value
      ? { default: String(value.default).replace(/^.*[\\\\/]src[\\\\/]/, "") }
      : typeof value === "string"
        ? value.replace(/^.*[\\\\/]src[\\\\/]/, "")
        : value,
  );
const tried = async (label, load) => {
  try {
    console.log("SEEN ${first} " + label + " | " + shown(await load()));
  } catch (error) {
    console.log("SEEN ${first} " + label + " | throws " + error.name);
  }
};
const put = name => "./src/" + name;
const unknown = name => process.env.FOLDER_OF_FILES + name;
test("a file that is no code, by import and by require", async () => {
  await tried("the statement", () => picture);
  await tried("require behind the statement", () => require(${at(first + "1.png")}));
  await tried("again", () => require(${at(first + "1.png")}));
  await tried("require alone", () => require(${at(first + "2.png")}));
  await tried("import() behind that require", () => import("./src/${first}2.png"));
  await tried("require behind both", () => require(${at(first + "2.png")}));
  await tried("import() alone", () => import("./src/${first}3.png"));
  await tried("require behind that import()", () => require(${at(first + "3.png")}));
  await tried("require of code under an ending that nothing names", () => require(${at(first + "4.weird")}));
  await tried("import() of code under an ending that nothing names", () => import("./src/${first}5.weird"));
  await tried("require behind it", () => require(${at(first + "5.weird")}));
  expect(put("") + unknown("")).toBeString();
});
`;

const files: Record<string, string> = {
  "package.json": `{ "name": "p", "type": "module" }
`,
  "tsconfig.json": `{}
`,
  "written.test.js": body(name => JSON.stringify("./src/" + name), "w"),
  "put-together.test.js": body(name => `put(${JSON.stringify(name)})`, "p"),
  "unknown.test.js": body(name => `unknown(${JSON.stringify(name)})`, "u"),
};
for (const first of ["w", "p", "u"]) {
  for (const number of [1, 2, 3]) files[`src/${first}${number}.png`] = picture;
  for (const number of [4, 5]) files[`src/${first}${number}.weird`] = code;
}

async function seenIn(directory: string, words: string | undefined, ...flags: string[]) {
  const env = {
    ...bunEnv,
    FOLDER_OF_FILES: directory + "/src/",
    ...(words ? { BUN_DEBUG_TEST_AOT_WORDS: words } : {}),
  };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], directory, env);
  // The workers of a parallel run say it on the other stream.
  const lines = (stdout + "\n" + stderr).split("\n");
  return { seen: lines.filter(line => line.startsWith("SEEN ")).sort(), exitCode };
}

test("require() of a file that nothing names the kind of answers what an import has loaded", async () => {
  using directory = tempDir("require-of-a-file-that-an-import-has-loaded", files);
  const plain = await seenIn(String(directory), undefined);
  expect(plain.seen).toContain(`SEEN w require behind the statement | {"default":"w1.png"}`);
  expect(plain.seen).toContain(`SEEN w require alone | throws BuildMessage`);
  expect(plain.seen).toContain(`SEEN u require of code under an ending that nothing names | 7`);
  expect(plain.seen).toHaveLength(33);
  expect(await seenIn(String(directory), "TestRunLayers:0", "--aot")).toEqual(plain);
  expect(await seenIn(String(directory), "TestRunLayers:2,TestRunPartFiles:1", "--aot", "--parallel=2")).toEqual(plain);
}, 240_000);
