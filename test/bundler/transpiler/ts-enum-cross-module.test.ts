import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// https://github.com/oven-sh/bun/issues/37257
// When an enum member's value is not statically known (e.g. it references an
// enum from another transpile unit), the reverse mapping must be decided at
// runtime: string members must not get one, numeric members must keep theirs.
describe.concurrent("enum member referencing an enum from another module", () => {
  test("string member gets no reverse mapping", async () => {
    using dir = tempDir("enum-cross-module-string", {
      "enum1.ts": `export enum Enum1 { K1 = "V" }`,
      "main.ts": `
        import { Enum1 } from "./enum1";
        enum Enum2 { K2 = Enum1.K1 }
        console.log(JSON.stringify({
          entries: Object.entries(Enum2),
          keys: Object.keys(Enum2),
          values: Object.values(Enum2),
        }));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      entries: [["K2", "V"]],
      keys: ["K2"],
      values: ["V"],
    });
    expect(exitCode).toBe(0);
  });

  test("numeric member keeps its reverse mapping", async () => {
    using dir = tempDir("enum-cross-module-number", {
      "enum1.ts": `export enum Enum1 { K1 = 7 }`,
      "main.ts": `
        import { Enum1 } from "./enum1";
        enum Enum2 { K2 = Enum1.K1 }
        console.log(JSON.stringify(Object.entries(Enum2)));
      `,
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.ts"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual([
      ["7", "K2"],
      ["K2", 7],
    ]);
    expect(exitCode).toBe(0);
  });
});
