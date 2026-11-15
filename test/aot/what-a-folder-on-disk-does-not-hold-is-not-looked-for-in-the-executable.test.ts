import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, test } from "./harness/default-timeout";
import { run } from "./harness/run";

const nameOfExecutable = isWindows ? "tool.exe" : "tool";

const cli = `
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const held = require("dock");
const there = path.join(process.cwd(), "x.js");
const fromThere = require("node:module").createRequire(there);
const roads = {
  "Bun.resolveSync": () => Bun.resolveSync("dock", process.cwd()),
  "what a made require resolves": () => fromThere.resolve("dock"),
  "import.meta.resolve with a parent": () => import.meta.resolve("dock", pathToFileURL(there).href),
};
(async () => {
  try {
    console.log(JSON.stringify({ answer: await roads[process.argv[2]]() }));
  } catch (error) {
    console.log(JSON.stringify({ threw: error.code ?? error.name }));
  }
})();
`;

const dir = tempDir("aot-not-found-from-a-folder-on-disk", {
  "tool/cli.cjs": cli,
  "tool/node_modules/dock/package.json": `{ "name": "dock", "main": "index.js" }`,
  "tool/node_modules/dock/index.js": `exports.owner = "the tool";\n`,
});
afterAll(() => dir[Symbol.dispose]());
const directory = String(dir);

const forms = { bundle: [], closed: ["--aot"], withCodeFromDisk: ["--aot", "--aot-allow-code-from-disk"] };
let built:
  Promise<(form: keyof typeof forms, road: string) => Promise<{ answer?: unknown; threw?: string }>> | undefined;
const setUp = () =>
  (built ??= (async () => {
    mkdirSync(join(directory, "empty"));
    for (const [form, flags] of Object.entries(forms)) {
      const outfile = join(directory, "bin", form, nameOfExecutable);
      const { stderr, exitCode } = await run(
        [bunExe(), "build", "--compile", ...flags, "./cli.cjs", "--outfile", outfile],
        join(directory, "tool"),
      );
      expect({ stderr: exitCode === 0 ? "" : stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    }
    return async (form, road) => {
      const { stdout, stderr, exitCode } = await run(
        [join(directory, "bin", form, nameOfExecutable), road],
        join(directory, "empty"),
        bunEnv,
      );
      expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
      return JSON.parse(stdout);
    };
  })());

test.each(["Bun.resolveSync", "what a made require resolves", "import.meta.resolve with a parent"])(
  "%s",
  async road => {
    const ask = await setUp();
    const bundle = await ask("bundle", road);
    expect(await ask("closed", road)).toEqual(bundle);
    expect(await ask("withCodeFromDisk", road)).toEqual(bundle);
  },
  600_000,
);
