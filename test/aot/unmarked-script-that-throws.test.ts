import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// A `.js` file that has neither `import` | `export` nor `require` | `module` | `exports` is CommonJS to `require`, unless its
// package says "type": "module". A CommonJS module that throws while it is loaded is loaded again by the next `require`; an
// ES module keeps its error. `bun run --aot` must tell the two apart as `bun run` does.

const throws = (name: string) => `globalThis.times = (globalThis.times || 0) + 1;
console.log("${name} begins, time", globalThis.times);
throw new Error("thrown at load");
`;

const files = {
  "lib/unmarked.js": throws("unmarked.js"),
  "lib/unmarked.mjs": throws("unmarked.mjs"),
  "lib/says-exports.js": throws("says-exports.js") + "module.exports = 1;\n",
  "lib/has-export.js": throws("has-export.js") + "export {};\n",
  "in-module-package/package.json": `{ "name": "in-module-package", "type": "module" }`,
  "in-module-package/unmarked.js": throws("in-module-package/unmarked.js"),
  "in-commonjs-package/package.json": `{ "name": "in-commonjs-package", "type": "commonjs" }`,
  "in-commonjs-package/unmarked.js": throws("in-commonjs-package/unmarked.js"),
  "twice.cjs": `const twice = load => { globalThis.times = 0; for (const time of [1, 2]) { try { load(); } catch (error) { console.log("caught:", error.message); } } };
twice(() => require("./lib/unmarked.js"));
twice(() => require("./lib/unmarked.mjs"));
twice(() => require("./lib/says-exports.js"));
twice(() => require("./lib/has-export.js"));
twice(() => require("./in-module-package/unmarked.js"));
twice(() => require("./in-commonjs-package/unmarked.js"));
`,
  "import-first.mjs": `import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
try { await import("./lib/unmarked.js"); } catch (error) { console.log("import caught:", error.message); }
try { require("./lib/unmarked.js"); } catch (error) { console.log("require caught:", error.message); }
try { await import("./lib/unmarked.js"); } catch (error) { console.log("import caught:", error.message); }
`,
};

async function spawned(cmd: string[], cwd: string, env: Record<string, string | undefined> = bunEnv) {
  await using proc = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.concurrent.each(["twice.cjs", "import-first.mjs"])("bun run --aot loads a file that threw as often as bun run does: %s", async entry => {
  using dir = tempDir("unmarked-script-that-throws", files);
  const plain = await spawned([bunExe(), "run", entry], String(dir));
  expect(plain.exitCode).toBe(0);
  const aot = await spawned([bunExe(), "run", "--aot", entry], String(dir), { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
  expect(aot.stderr).not.toContain("crashIfInterpreterIsUsed");
  expect({ stdout: aot.stdout, exitCode: aot.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
});

test("an unmarked .js file is loaded again, one in a module package is not", async () => {
  using dir = tempDir("unmarked-script-that-throws", files);
  const { stdout } = await spawned([bunExe(), "run", "--aot", "twice.cjs"], String(dir));
  expect(stdout).toContain("unmarked.js begins, time 2");
  expect(stdout).not.toContain("in-module-package/unmarked.js begins, time 2");
});
