import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("accessing Bun.sql after corrupting globalThis.Array returns undefined instead of crashing", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      // When Array is corrupted, the SQL module fails to load because
      // "class SQLResultArray extends PublicArray" throws. The PropertyCallback
      // must not return an empty JSValue (which causes a null cell deref in
      // reifyStaticProperty), but should return undefined gracefully.
      `globalThis.Array = undefined; console.log(typeof Bun.sql);`,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const stdout = await proc.stdout.text();
  const exitCode = await proc.exited;

  // Fixed: returns undefined gracefully instead of throwing/crashing
  expect(stdout.trim()).toBe("undefined");
  expect(exitCode).toBe(0);
});

test("enumerating all Bun properties after corrupting globals does not crash", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      // Corrupting Array and then enumerating all Bun object properties
      // triggers every lazy PropertyCallback. None of them should crash
      // by returning an empty JSValue.
      `globalThis.Array = undefined;
const names = Object.getOwnPropertyNames(Bun);
for (let i = 0; i < names.length; i++) {
  try { Bun[names[i]]; } catch(e) {}
}
console.log("ok");`,
    ],
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const stdout = await proc.stdout.text();
  const exitCode = await proc.exited;

  expect(stdout.trim()).toBe("ok");
  expect(exitCode).toBe(0);
});
