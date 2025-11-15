import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("issue #24505 - doesn't crash when visiting macro-generated objects", async () => {
  // This test ensures that when macros return objects with many properties,
  // the AST visitor doesn't crash when visiting property values
  using dir = tempDir("issue-24505", {
    "macro.ts": `
      export function generateObject() {
        const obj: Record<string, any> = {};

        for (let i = 0; i < 50; i++) {
          obj[\`key\${i}\`] = {
            value: i,
            nested: {
              data: \`value_\${i}\`,
              index: i,
            },
          };
        }

        return obj;
      }
    `,
    "index.ts": `
      import { generateObject } from "./macro.ts" with { type: "macro" };

      const data = generateObject();
      console.log(Object.keys(data).length);
    `,
  });

  // Run the build multiple times to catch flaky crashes
  for (let attempt = 0; attempt < 3; attempt++) {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "build", "index.ts", "--outdir=out", "--target=bun"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Should not crash
    expect(stderr).not.toContain("panic");
    expect(stderr).not.toContain("Segmentation fault");
    expect(exitCode).toBe(0);
  }
}, 30000);
