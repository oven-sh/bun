import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// The files that Workers start from are entry points of the one program of a test run. The build learns of them from the files it has loaded.
// The program goes by the tsconfig.json that is nearest to the most entry points. Here that is another one once the Workers' files are known,
// so the build loads all files anew with them. A file that a Worker starts from may start a Worker too, here four in a row, each named in a
// file that only the one before it imports: the build follows the row at once and loads all files one more time, not four.
// Where the configuration stays the same: a-test-run-that-starts-workers-loads-its-files-once.test.ts.
const files: Record<string, string> = {
  "package.json": `{ "type": "module" }`,
  "src/tsconfig.json": "{}",
  "chain.test.ts": `import { test, expect } from "bun:test";
    import { start } from "./src/start";
    test("a row of Workers", async () => {
      expect(await start()).toBe("w1 w2 w3 w4");
    });`,
  "src/start.ts": `import { ask } from "./ask";\nexport const start = () => ask(new URL("./w1.ts", import.meta.url));`,
  "src/ask.ts": `export const ask = (url: URL) =>
    new Promise<string>((resolve, reject) => {
      const worker = new Worker(url);
      worker.onmessage = event => (resolve(event.data), worker.terminate());
      worker.onerror = event => reject(new Error(event.message));
    });`,
  "src/w4.ts": `postMessage("w4");`,
};
for (const i of [1, 2, 3]) {
  files[`src/w${i}.ts`] =
    `import { ask } from "./ask";\nimport { next } from "./names${i}";\npostMessage("w${i} " + (await ask(next)));`;
  files[`src/names${i}.ts`] = `export const next = new URL("./w${i + 1}.ts", import.meta.url);`;
}

async function runTests(directory: string, ...flags: string[]) {
  const env = { ...bunEnv, BUN_JSC_logAOTPhaseTimes: flags.length ? "1" : undefined };
  const { stderr, exitCode } = await run([bunExe(), "test", "--timeout=60000", ...flags], directory, env);
  if (exitCode !== 0) console.error(stderr);
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  const loadedAgain = [...stderr.matchAll(/^AOT files are loaded again \| (.*)$/gm)].map(match => match[1]);
  return { results, exitCode, loadedAgain };
}

test("the build follows a row of Workers before it loads all files anew", async () => {
  using dir = tempDir("aot-workers-that-start-workers", files);
  expect(await runTests(String(dir))).toEqual({ results: ["pass a row of Workers"], exitCode: 0, loadedAgain: [] });
  expect(await runTests(String(dir), "--aot")).toEqual({
    results: ["pass a row of Workers"],
    exitCode: 0,
    loadedAgain: ["with 4 more files that Workers start from"],
  });
}, 120_000);
