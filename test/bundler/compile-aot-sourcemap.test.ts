import { spawn } from "bun";
import { expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

setDefaultTimeout(60_000);

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
    compilerOptions: { strict: true, module: "esnext", moduleResolution: "bundler", target: "esnext", types: [], lib: ["esnext", "dom"] },
  }),
};
const note = "note: --sourcemap adds nothing to --aot";

async function built(flags: string[]) {
  const dir = String(tempDir("compile-aot-sourcemap", files));
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

test.each(["--sourcemap", "--sourcemap=inline", "--sourcemap=external", "--sourcemap=linked"])(
  "--aot %s: the build says that the positions are the sources' already",
  async flag => {
    const { said, stdout } = await built(["--aot", flag]);
    expect(said).toContain(note);
    expect(stdout).toBe("Error: failed\n    at fail (app.ts:3:13)\n    at app.ts:6:3\n");
  },
);

test.each([[["--aot"]], [["--aot", "--sourcemap=none"]], [["--sourcemap=external"]]])("%p: it says nothing", async flags => {
  const { said } = await built(flags);
  expect(said).not.toContain(note);
});

test("bun run --aot, which asks for a source map by itself: it says nothing", async () => {
  const dir = String(tempDir("compile-aot-sourcemap", files));
  await using run = spawn({ cmd: [bunExe(), "run", "--aot", "app.ts"], cwd: dir, env: bunEnv, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
  expect(stderr).not.toContain(note);
  expect(stdout).toContain("Error: failed\n    at fail (");
  expect(exitCode).toBe(0);
});
