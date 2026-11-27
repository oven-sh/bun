import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { spawned } from "./harness/commands";
import { describe, test } from "./supported";

const timeout = 240_000;
const plugin = `Bun.plugin({
  name: "made",
  setup(build) {
    build.onLoad({ filter: /\\.vue$/ }, () => ({ contents: "exports.k = 'made';", loader: "js" }));
  },
});
`;
const helpers = `const name = value => String(globalThis.nothing ?? value);
const resolved = () => console.log("resolve", require.resolve("./a" + name(".vue")).split(/[\\\\/]/).at(-1));
const required = path => {
  try {
    console.log("require", JSON.stringify(require(path)));
  } catch {
    console.log("require threw");
  }
};
`;
const programs: Record<string, [string, string]> = {
  "a load plugin of the program is asked for it": [
    `${plugin}${helpers}resolved();
required(name("./a.vue"));
required(require.resolve("./a" + name(".vue")));
`,
    'resolve a.vue\nrequire {"k":"made"}\nrequire {"k":"made"}\n',
  ],
  "a require() in front of it": [
    `${plugin}${helpers}required(name("./a.vue"));
resolved();
`,
    'require {"k":"made"}\nresolve a.vue\n',
  ],
  "no plugin answers for it": [
    `${helpers}resolved();
required(name("./a.vue"));
`,
    "resolve a.vue\nrequire threw\n",
  ],
};

describe("require.resolve() of a computed name of a file of an unknown kind", () => {
  for (const [name, [entry, stdout]] of Object.entries(programs))
    test.concurrent(
      name,
      async () => {
        using dir = tempDir("aot-resolve-unknown-kind", { "a.vue": "<template/>\n", "entry.cjs": entry });
        const folder = String(dir);
        const plain = await spawned([bunExe(), "entry.cjs"], folder, bunEnv);
        expect(plain.stdout).toBe(stdout);
        const executable = join(folder, isWindows ? "program.exe" : "program");
        const built = await spawned(
          [bunExe(), "build", "--compile", "--aot", "./entry.cjs", "--outfile", executable],
          folder,
          bunEnv,
        );
        expect(built.exitCode).toBe(0);
        expect((await spawned([executable], folder, bunEnv)).stdout).toBe(stdout);
      },
      timeout,
    );
});
