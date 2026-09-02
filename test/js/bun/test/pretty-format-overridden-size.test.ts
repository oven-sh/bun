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
const cases = [];
{
  const weakSet = new WeakSet();
  weakSet.size = BigUint64Array;
  cases.push({ value: weakSet, includes: ["WeakSet {}"] });
}
{
  const weakMap = new WeakMap();
  weakMap.size = "not a number";
  cases.push({ value: weakMap, includes: ["WeakMap {}"] });
}
{
  // The real entries must still print even though \`size\` is unusable.
  const set = new Set(["set entry"]);
  Object.defineProperty(set, "size", { value: {} });
  cases.push({ value: set, includes: ["Set {", '"set entry"'], excludes: ["Set {}"] });
}
{
  const map = new Map([["map key", "map value"]]);
  Object.defineProperty(map, "size", { value: BigUint64Array });
  cases.push({ value: map, includes: ["Map {", '"map key"', '"map value"'], excludes: ["Map {}"] });
}
{
  const weakSet = new WeakSet();
  weakSet.size = Symbol("size");
  cases.push({ value: weakSet, includes: ["WeakSet {}"] });
}
for (const { value, includes, excludes = [] } of cases) {
  try {
    Bun.jest().expect(BigUint64Array).toEqual(value);
    console.log("DID NOT THROW");
  } catch (e) {
    const ok =
      e.message.includes("expect(received).toEqual(expected)") &&
      includes.every(s => e.message.includes(s)) &&
      excludes.every(s => !e.message.includes(s));
    console.log(ok ? "DIFF OK" : "UNEXPECTED: " + e.message);
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
