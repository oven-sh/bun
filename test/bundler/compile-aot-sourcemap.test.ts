import { spawn } from "bun";
import { expect, setDefaultTimeout } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { test } from "../aot/supported";

setDefaultTimeout(60_000);

const root = isWindows ? "B:\\~BUN\\root\\" : "/$bunfs/root/";

const files = {
  "app.ts": `
function fail(): never {
  throw new Error("failed");
}
try {
  fail();
} catch (error) {
  console.log(String((error as Error).stack));
}
`,
  "tsconfig.json": JSON.stringify({
    compilerOptions: {
      strict: true,
      module: "esnext",
      moduleResolution: "bundler",
      target: "esnext",
      types: [],
      lib: ["esnext", "dom"],
    },
  }),
};
const note = "note: only --sourcemap=external has an effect with --aot";

async function built(flags: string[]) {
  using folder = tempDir("compile-aot-sourcemap", files);
  const dir = String(folder);
  await using build = spawn({
    cmd: [bunExe(), "build", "--compile", ...flags, "app.ts", "--outfile", "app"],
    cwd: dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [said, buildExitCode] = await Promise.all([build.stderr.text(), build.exited]);
  expect(buildExitCode).toBe(0);
  await using run = spawn({ cmd: [join(dir, "app")], cwd: dir, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, exitCode] = await Promise.all([run.stdout.text(), run.exited]);
  expect(exitCode).toBe(0);
  return { said, stdout };
}

test.each(["--sourcemap", "--sourcemap=inline", "--sourcemap=linked"])(
  "--aot %s: the build says that the positions are the sources' already",
  async flag => {
    const { said, stdout } = await built(["--aot", flag]);
    expect(said).toContain(note);
    expect(stdout).toBe(`Error: failed\n    at fail (${root}app.ts:3:13)\n    at ${root}app.ts:6:3\n`);
  },
);

test("--aot --sourcemap=external: the positions are in the map", async () => {
  const { said, stdout } = await built(["--aot", "--sourcemap=external"]);
  expect(said).not.toContain(note);
  expect(stdout.replace(/\d+/g, "N")).toBe(
    `Error: failed\n    at <anonymous> (${root}compiled.js:N:N)\n    at ${root}compiled.js:N:N\n`,
  );
});

test.each([[["--aot"]], [["--aot", "--sourcemap=none"]], [["--sourcemap=external"]]])(
  "%p: prints no note",
  async flags => {
    const { said } = await built(flags);
    expect(said).not.toContain(note);
  },
);

test("bun run --aot, which requests a source map itself: prints no note", async () => {
  using folder = tempDir("compile-aot-sourcemap", files);
  const dir = String(folder);
  await using run = spawn({
    cmd: [bunExe(), "run", "--debug-aot", "app.ts"],
    cwd: dir,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
  expect(stderr).not.toContain(note);
  expect(stdout).toContain("Error: failed\n    at fail (");
  expect(exitCode).toBe(0);
});
