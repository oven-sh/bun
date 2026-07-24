// Regression test for the jest pretty formatter reading an overridden `size`
// property off (Weak)Set/(Weak)Map values while printing a toEqual diff.
// Previously a non-numeric `size` hit the isInt32() assertion in
// JSC::JSValue::asInt32() on debug builds.

import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe("pretty_format should handle collections with an overridden `size` property", () => {
  test("non-numeric `size` on (Weak)Set/(Weak)Map still produces a toEqual diff", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
const values = [];
{
  const weakSet = new WeakSet();
  weakSet.size = BigUint64Array;
  values.push(weakSet);
}
{
  const weakMap = new WeakMap();
  weakMap.size = "not a number";
  values.push(weakMap);
}
{
  const set = new Set([1]);
  Object.defineProperty(set, "size", { value: {} });
  values.push(set);
}
{
  const map = new Map([[1, 2]]);
  Object.defineProperty(map, "size", { value: BigUint64Array });
  values.push(map);
}
{
  const weakSet = new WeakSet();
  weakSet.size = Symbol("size");
  values.push(weakSet);
}
for (const value of values) {
  try {
    Bun.jest().expect(BigUint64Array).toEqual(value);
    console.log("DID NOT THROW");
  } catch (e) {
    console.log(e.message.includes("expect(received).toEqual(expected)") ? "DIFF OK" : "UNEXPECTED: " + e.message);
  }
}
`,
      ],
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim().split("\n")).toEqual(["DIFF OK", "DIFF OK", "DIFF OK", "DIFF OK", "DIFF OK"]);
    expect(exitCode).toBe(0);
  });
});
