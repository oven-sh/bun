import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const members = ["origin", "isStandaloneExecutable", "version_with_sha", "ModuleGraph"];
const files = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "lib.js": `export const read = () => [${members.map(member => `Bun.${member}`).join(", ")}].map(value => typeof value + " " + (value === "spied")).join(", ");
export const usesBun = Bun.file("x.txt").name + Bun.inspect(1);
`,
  "a.test.js": `import { test, vi } from "bun:test";
import { read } from "./lib.js";
test("t", () => {
  console.log("SEEN", read());
${members.map(member => `  vi.spyOn(Bun, "${member}", "get").mockReturnValue("spied");`).join("\n")}
  console.log("SEEN", read(), [${members.map(member => `Bun.${member}`).join(", ")}].join());
  vi.restoreAllMocks();
  console.log("SEEN", read());
});
`,
};

test.each([
  ["as one program", "TestRunLayers:0"],
  ["over two layers", "TestRunLayers:2,TestRunPartFiles:1"],
])("a spy on a read-only member of Bun that changes on its own, %s", async (_, words) => {
  using dir = tempDir("aot-spy-changing-member", files);
  const seen = async (flags: string[], env: typeof bunEnv) => {
    const { stdout, stderr } = await run([bunExe(), "test", ...flags], String(dir), env);
    return (stdout + "\n" + stderr).split("\n").filter(line => /^SEEN|^ *\d+ (pass|fail)$|^\w*Error/.test(line));
  };
  const plain = await seen([], bunEnv);
  expect(plain[1]).toEndWith("spied,spied,spied,spied");
  expect(await seen(["--aot"], { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words })).toEqual(plain);
});
