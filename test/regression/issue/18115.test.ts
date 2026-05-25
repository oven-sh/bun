import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/18115
// `String.raw` and `RegExp.prototype.source` must preserve non-ASCII bytes
// verbatim — the printer previously escaped them to `\uXXXX`, changing
// runtime values (e.g. `String.raw\`é\``.length was 6 instead of 1).

test("String.raw preserves non-ASCII characters", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      "process.stdout.write(JSON.stringify([String.raw`Redémarrage`, String.raw`a中`, String.raw`╭─╮`, String.raw`🐰`]))",
    ],
    env: bunEnv,
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toBe(JSON.stringify(["Redémarrage", "a中", "╭─╮", "🐰"]));
  expect(exitCode).toBe(0);
});

test("RegExp.source preserves non-ASCII characters", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      "process.stdout.write(JSON.stringify([/Redémarrage/.source, /╭─╮/.source, /a中/.source]))",
    ],
    env: bunEnv,
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect(stdout).toBe(JSON.stringify(["Redémarrage", "╭─╮", "a中"]));
  expect(exitCode).toBe(0);
});

