import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// https://github.com/oven-sh/bun/issues/32686
test.concurrent.each(["./src/worker.ts", "../src/worker.ts", "/abs/path", "/$bunfs/root/worker", ".", "/", "/=foo"])(
  "define value %j is auto-quoted",
  async value => {
    using dir = tempDir("bun-build-define-32686", {
      "entry.ts": `declare const X: string; console.log(X);`,
    });
    const result = await Bun.build({
      entrypoints: [join(String(dir), "entry.ts")],
      define: { X: value },
    });
    expect(result.success).toBe(true);
    const out = await result.outputs[0].text();
    expect(out).toContain(JSON.stringify(value));
  },
);

test.concurrent("--define CLI auto-quotes a value starting with a dot", async () => {
  using dir = tempDir("bun-build-define-32686-cli", {
    "entry.ts": `declare const X: string; console.log(X);`,
  });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--define", "X=./src/worker.ts", "entry.ts"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr, exitCode }).toMatchObject({ exitCode: 0 });
  expect(stdout).toContain(JSON.stringify("./src/worker.ts"));
});
