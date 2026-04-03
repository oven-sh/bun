import { bunEnv, bunExe } from "harness";
import { expect, test } from "bun:test";

test("issue 24851: default locale follows environment", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      "console.log(new Intl.DateTimeFormat().resolvedOptions().locale);",
    ],
    env: { ...bunEnv, LANG: "en_IN.UTF-8", TZ: "UTC" },
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout.text(),
    proc.stderr.text(),
    proc.exited,
  ]);

  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("en-IN");
  expect(exitCode).toBe(0);
});

