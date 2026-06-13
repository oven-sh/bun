import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Regression test: DFG graph dump should not crash when printing
// JSConstant objects that have a null butterfly (objects with only
// inline properties and no indexed storage).
test("DFG dump handles objects with null butterfly", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      function f() {
        const sab = new SharedArrayBuffer(0, { maxByteLength: 248 });
        const ta = new Float32Array(sab);
        const arr = [ta, Float32Array];
        const w = arr * 0;
        try { sab.grow(sab.byteLength + 100); } catch(e) {}
        const ab = new ArrayBuffer(64, { maxByteLength: 1024 });
        new Uint8ClampedArray(ab);
        +sab;
      }
      for (let i = 0; i < 100; i++) f();
      console.log("ok");
      `,
    ],
    env: {
      ...bunEnv,
      BUN_JSC_validateGraph: "1",
    },
    stderr: "ignore",
    stdout: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);

  expect(stdout).toBe("ok\n");
  expect(exitCode).toBe(0);
});
