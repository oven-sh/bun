import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("Bun.SQL loads when globalThis.Array is overwritten", async () => {
  const src = `
    const OrigArray = Array;
    globalThis.Array = () => {};
    const sql = new Bun.SQL("sqlite://:memory:");
    const rows = await sql\`SELECT 1 as x\`;
    globalThis.Array = OrigArray;
    if (!Array.isArray(rows)) throw new Error("result is not an array");
    if (!(rows instanceof Array)) throw new Error("result is not instanceof Array");
    if (rows[0].x !== 1) throw new Error("unexpected row: " + JSON.stringify(rows));
    const { sql: defaultSql } = Bun;
    if (typeof defaultSql !== "function") throw new Error("Bun.sql is not a function");
    await sql.end();
    console.log("ok");
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr }).toEqual({ stdout: "ok", stderr: "" });
  expect(exitCode).toBe(0);
});
