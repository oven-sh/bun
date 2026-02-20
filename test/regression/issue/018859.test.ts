import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("tagged template literals preserve non-ASCII in .raw", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `function tag(strings) { return strings.raw[0]; } console.log(tag\`Привет, Мир\`);`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("Привет, Мир");
  expect(exitCode).toBe(0);
});

test("shell $ preserves non-ASCII characters", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `import {$} from "bun"; await $\`echo "Hello world: Привет, Мир"\`;`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("Hello world: Привет, Мир");
  expect(exitCode).toBe(0);
});

test("tagged template literals preserve CJK characters in .raw", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `function tag(strings) { return strings.raw[0]; } console.log(tag\`你好世界\`);`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("你好世界");
  expect(exitCode).toBe(0);
});

test("tagged template literals preserve emoji in .raw", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `function tag(strings) { return strings.raw[0]; } console.log(tag\`Hello 🌍\`);`],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout.trim()).toBe("Hello 🌍");
  expect(exitCode).toBe(0);
});
