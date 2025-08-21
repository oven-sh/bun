import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

test("should not duplicate exports when using alias with code splitting", async () => {
  const dir = tempDirWithFiles("duplicate-exports", {
    "export.ts": `
const c = {
  test: ""
}

export { c as ThisShouldBeImported_NotTheOriginal }
    `.trim(),
    "import.ts": `
import { ThisShouldBeImported_NotTheOriginal } from "./export";

export const impl = {
  ...ThisShouldBeImported_NotTheOriginal
}
    `.trim(),
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "build", "--splitting", "--target=bun", "import.ts", "export.ts", "--outdir=out"],
    cwd: dir,
    env: bunEnv,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);
  expect(stderr).toBe("");

  // Read the generated export file
  const exportFile = await Bun.file(`${dir}/out/export.js`).text();

  // Both export statements should use the correct alias name, not the original symbol name
  const exportMatches = exportFile.match(/export\s*{[^}]*}/g) || [];

  // The key fix: no export should use the original symbol name 'c' alone
  expect(exportFile).not.toMatch(/export\s*{\s*c\s*}/); // Should not have bare export { c }

  // All exports should use the alias name
  expect(exportFile).toContain("c as ThisShouldBeImported_NotTheOriginal");

  // Every export statement should use the alias, not the original symbol name
  for (const exportMatch of exportMatches) {
    if (exportMatch.includes("c")) {
      expect(exportMatch).toContain("ThisShouldBeImported_NotTheOriginal");
    }
  }

  // Read the generated import file
  const importFile = await Bun.file(`${dir}/out/import.js`).text();

  // Import should use the correct alias name
  expect(importFile).toContain("ThisShouldBeImported_NotTheOriginal");
});
