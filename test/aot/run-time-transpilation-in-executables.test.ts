import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./supported";

test("an executable transpiles files it loads at run time with the same defines as plain Bun", async () => {
  const loaded = `
export const facts = {
  window: typeof window,
  nodeEnv: process.env.NODE_ENV ?? null,
  pure: (() => { Math.abs(-1); Array.isArray([]); return "kept"; })(),
  jsx: typeof (<div />).type,
};
`;
  using dir = tempDir("aot-run-time-transpilation", {
    "main.ts": `
const path: string = process.argv[2]!;
const first = await import(path + "/loaded.tsx");
const second = require(path + "/required.ts");
const worker = new Worker(path + "/worker.ts");
worker.onmessage = (event: { data: string }) => {
  console.log(JSON.stringify({ first: first.facts, second: second.facts, worker: JSON.parse(event.data) }));
  worker.terminate();
};
`,
    "files/loaded.tsx": loaded,
    "files/required.ts": loaded.replace("jsx: typeof (<div />).type,", ""),
    "files/worker.ts": `import { facts } from "./required.ts";\npostMessage(JSON.stringify(facts));\n`,
    "files/node_modules/react/jsx-dev-runtime.js": `export const jsxDEV = (type) => ({ type }); export const Fragment = "fragment";`,
    "files/node_modules/react/jsx-runtime.js": `export const jsx = (type) => ({ type }); export const Fragment = "fragment";`,
  });
  const run = async (cmd: string[], env: Record<string, string | undefined> = {}) => {
    await using proc = Bun.spawn({ cmd, cwd: String(dir), env: { ...bunEnv, NODE_ENV: undefined, ...env }, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  };
  const build = await run([bunExe(), "build", "--compile", "--aot", "./main.ts", "--outfile", "program"]);
  expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
  const program = join(String(dir), isWindows ? "program.exe" : "program");
  const files = join(String(dir), "files");
  for (const env of [{}, { NODE_ENV: "production" }, { NODE_ENV: "development" }]) {
    const plain = await run([bunExe(), "main.ts", files], env);
    expect({ stderr: plain.stderr, exitCode: plain.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    const compiled = await run([program, files], env);
    expect({ stdout: compiled.stdout, stderr: compiled.stderr, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, stderr: "", exitCode: 0 });
  }
}, 120_000);
