import { expect, it } from "bun:test";
import { bunRunAsScript, tempDirWithFiles } from "harness";

it("should handle quote escapes", () => {
  const package_json = JSON.stringify({
    scripts: {
      test: `echo "test\\\\$(pwd)"`,
    },
  });
  expect(package_json).toContain('\\"');
  expect(package_json).toContain("\\\\");
  const dir = tempDirWithFiles("run-quote", { "package.json": package_json });
  const { stdout } = bunRunAsScript(dir, "test");
  expect(stdout).toBe(`test\\${dir}`);
});
