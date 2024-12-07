import { test, expect } from "bun:test";
import { bunExe, bunEnv, tempDirWithFiles } from "harness";

for (const mode of ["none", "--todo", "withTodo"]) {
  for (const shouldPass of [false, true]) {
    test("todo tests with " + mode + " that " + (shouldPass ? "passes" : "fails"), () => {
      const files = tempDirWithFiles("todo", {
        "my.test.ts": /*js*/ `
        import { test, expect } from "bun:test"${mode === "withTodo" ? ` with { todo: "true" }` : ""};
        test.todo("unimplemented feature", () => {
          ${shouldPass ? "expect(true).toBe(true);" : "expect(true).toBe(false);"}
        });
      `,
      });

      const resultShouldFail = shouldPass && mode !== "none";
      const result = Bun.spawnSync({
        cmd: [bunExe(), "test", ...(mode === "--todo" ? ["--todo"] : []), "my.test.ts"],
        cwd: files,
        env: bunEnv,
        stdio: ["inherit", "inherit", resultShouldFail ? "pipe" : "inherit"],
      });

      if (resultShouldFail) {
        expect(result.stderr!.toString()).toContain("1 fail");
        expect(result.stderr!.toString()).toContain(
          "^ this test is marked as todo but passes. Remove `.todo` or check that test is correct.",
        );
        expect(result.exitCode).toBe(1);
      } else {
        expect(result.exitCode).toBe(0);
      }
    });
  }
}
