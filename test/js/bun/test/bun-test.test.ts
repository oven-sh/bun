import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("Bun.version", () => {
  expect(process.versions.bun).toBe(Bun.version);
  expect(process.revision).toBe(Bun.revision);
});

test("expect().not.not", () => {
  // bun supports this but jest doesn't
  expect(1).not.not.toBe(1);
  expect(1).not.not.not.toBe(2);
});

// Fuzzer-found crash: Bun.jest() without an active test runner, followed by
// misuse of the expect statics, must not crash the process.
test("Bun.jest() expect statics do not crash on misuse", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const jestExpect = Bun.jest().expect;
      try { jestExpect.extend(); } catch {}
      const arrayContaining = jestExpect.arrayContaining;
      try { new arrayContaining(); } catch (e) { if (!(e instanceof TypeError)) throw e; }
      Bun.gc(true);
    `,
    ],
    env: bunEnv,
  });

  const exitCode = await proc.exited;

  expect(exitCode).toBe(0);
});
