import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(240_000);

// With so little memory the run cuts the files of the project into two programs by itself. Every filler imports slow.js, which so goes into the lower one, and
// user.js imports every filler, so it goes into the upper one.
const fillers = Array.from({ length: 20 }, (_, file) => ({
  path: `fill/f${file}.js`,
  text:
    `import "../slow.js";\n` +
    Array.from({ length: 1600 }, (_, index) => `export function f${file}_${index}(x) { return x + ${index}; }\n`).join(
      "",
    ),
}));

const files = {
  "package.json": `{ "name": "stuck-load-below", "type": "module" }`,
  ...Object.fromEntries(fillers.map(({ path, text }) => [path, text])),
  "k.js": `export const x = "real";\n`,
  "slow.js": `export const s = "slow";\n`,
  "user.js": `${fillers.map(({ path }) => `import "./${path}";\n`).join("")}import { x } from "./k.js";
import { s } from "./slow.js";
export const seen = x + "/" + s;
`,
  "preload.js": `globalThis.asked = Promise.withResolvers();
let calls = 0;
Bun.plugin({
  name: "does not answer the first time",
  setup(build) {
    build.onLoad({ filter: /slow\\.js$/ }, () => {
      globalThis.asked.resolve();
      if (++calls === 1) return new Promise(() => {});
    });
  },
});
`,
  "a.test.js": `import { test, vi } from "bun:test";
test("leaves an import that never settles", async () => {
  vi.doMock("./k.js", () => ({ x: "mock" }));
  await import("./k.js");
  void import("./user.js");
  await globalThis.asked.promise;
}, 30_000);
`,
  "b.test.js": `import { expect, test } from "bun:test";
import { seen } from "./user.js";
test("the next file loads the modules", () => expect(seen).toBe("real/slow"), 30_000);
`,
};

async function runTests(directory: string, ...flags: string[]) {
  const env = { ...bunEnv, BUN_JSC_logAOTPhaseTimes: flags.length ? "1" : undefined };
  const command = [
    bunExe(),
    "test",
    ...flags,
    "--parallel=1",
    "--no-isolate",
    "--timeout=100",
    "--preload",
    "./preload.js",
  ];
  const { stderr, exitCode } = await run([...command, "./a.test.js", "./b.test.js"], directory, env);
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  if (exitCode !== 0) console.error(stderr.slice(-2000));
  return { programs: stderr.match(/\| (\d+) programs, each may take/)?.[1], seen: { results, exitCode } };
}

test("a file that a plugin answers for takes its importers in the program above to the loader with it", async () => {
  using dir = tempDir("aot-stuck-load-below", files);
  const plain = await runTests(String(dir));
  expect(plain.seen).toEqual({
    results: ["pass leaves an import that never settles", "pass the next file loads the modules"],
    exitCode: 0,
  });
  const compiled = await runTests(String(dir), "--aot", "--aot-memory-limit", "1MB");
  expect(compiled).toEqual({ programs: "2", seen: plain.seen });
});
