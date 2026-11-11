// `delete require.cache[key]` does nothing for a compiled module, and the build says so with TS100091. A file that is not in the executable is read again behind
// the deletion, as in `bun <file>`, so the build says nothing there. A key that the build cannot read may name a compiled module.
import { expect } from "bun:test";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

type Case = { key: (part: string, outside: string) => string; warns: boolean };
const cases: Record<string, Case> = {
  "a compiled file by require.resolve": { key: () => `require.resolve("./part.cjs")`, warns: true },
  "a compiled file by its written path": { key: part => part, warns: true },
  "a compiled file by its path in a constant": { key: () => `whole`, warns: true },
  "a key that the build cannot read": { key: () => `process.argv[2]`, warns: true },
  "a file outside by require.resolve": { key: (_, outside) => `require.resolve(${outside})`, warns: false },
  "a file outside by its written path": { key: (_, outside) => outside, warns: false },
  "a text that is no whole path": { key: () => `"part.cjs"`, warns: false },
};

test.concurrent.each(Object.keys(cases))("%s", async name => {
  const { key, warns } = cases[name];
  using sources = tempDir("aot-a-deletion-from-require-cache", { "part.cjs": "exports.a = 1;\n" });
  using outside = tempDir("aot-a-deletion-from-require-cache-outside", {});
  const part = JSON.stringify(join(String(sources), "part.cjs"));
  const config = JSON.stringify(join(String(outside), "config.json"));
  const text = `const whole = ${part};\nrequire("./part.cjs");\ntry {\n  delete require.cache[${key(part, config)}];\n} catch {}\nconsole.log(typeof whole);\n`;
  await Bun.write(join(String(sources), "main.cjs"), text);
  const executable = join(String(outside), isWindows ? "program.exe" : "program");
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", executable],
    String(sources),
  );
  expect(built.exitCode).toBe(0);
  expect((built.stdout + built.stderr).includes("TS100091")).toBe(warns);
});
