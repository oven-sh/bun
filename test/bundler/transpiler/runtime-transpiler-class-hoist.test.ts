import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// The runtime transpiler hoists top-level class declarations to help cyclic
// imports. That hoist must not jump over an earlier reference to the class
// binding, or the temporal dead zone disappears.
describe("top-level class declaration TDZ", () => {
  const tdzFixture = (decl: string) => /* js */ `
    const out = [];
    try {
      out.push("typeof=" + typeof K);
      out.push("constructed=" + new K().constructor.name);
    } catch (e) {
      out.push("ERR=" + e.constructor.name);
    }
    ${decl}
    out.push("after=" + typeof K);
    console.log(out.join(" | "));
  `;

  async function run(cmd: string[], files: Record<string, string>) {
    using dir = tempDir("runtime-transpiler-class-tdz", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...cmd],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim(), stderr, exitCode };
  }

  test.each([
    ["class K { m() {} }", "class declaration"],
    ["export class K { m() {} }", "exported class declaration"],
    ["export default class K { m() {} }", "export default named class"],
  ])("preserved for a %s referenced before its declaration (%s)", async decl => {
    expect(await run(["index.mjs"], { "index.mjs": tdzFixture(decl) })).toMatchObject({
      stdout: "ERR=ReferenceError | after=function",
      exitCode: 0,
    });
  });

  test("preserved for a CommonJS top-level class declaration", async () => {
    expect(await run(["index.cjs"], { "index.cjs": tdzFixture("class K { m() {} }") })).toMatchObject({
      stdout: "ERR=ReferenceError | after=function",
      exitCode: 0,
    });
  });

  // Classes with no prior mention of their name are still hoisted. References
  // inside a preceding function body count as a mention, so those stay put.
  test("still hoisted when no already-visited statement mentions the name", async () => {
    const { stdout, exitCode } = await run(["build", "--no-bundle", "--target=bun", "index.mjs"], {
      "index.mjs": /* js */ `
        const unrelated = 1;
        export class A { m() { return "A"; } }
        function make() { return new B(); }
        export class B {}
        console.log(new A().m(), unrelated, make());
      `,
    });
    const order = ["class A", "unrelated = 1", "function make", "class B"]
      .map(s => [s, stdout.indexOf(s)] as const)
      .sort((a, b) => a[1] - b[1])
      .map(([s]) => s);
    expect({ order, exitCode }).toEqual({
      order: ["class A", "unrelated = 1", "function make", "class B"],
      exitCode: 0,
    });
  });
});
