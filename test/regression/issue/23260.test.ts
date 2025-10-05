import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import fs from "node:fs";
import path from "node:path";

describe("issue #23260 - dev server crash when HTML imported as text is modified", () => {
  test(
    "should not crash when HTML file with { type: 'text' } is modified",
    async () => {
      using dir = tempDir("23260", {
        "serve.ts": `
export default {
  routes: {
    "/*": import("./index.html"),
  },
  fetch() {}
};
      `,
        "index.html": `
<!DOCTYPE html>
<html>
  <head>
    <script src="app.tsx"></script>
    <title>Test</title>
  </head>
  <body></body>
</html>
      `,
        "app.tsx": `
import html from "./sample.html" with { type: "text" };
console.log(html);
      `,
        "sample.html": `
<!DOCTYPE html>
<html>
  <head>
    <title>Sample</title>
  </head>
  <body></body>
</html>
      `,
      });

      // Start the dev server
      await using proc = Bun.spawn({
        cmd: [bunExe(), "serve"],
        cwd: String(dir),
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
      });

      // Wait for server to start
      await Bun.sleep(3000);

      // Modify the HTML file that's imported with { type: "text" }
      const sampleHtmlPath = path.join(String(dir), "sample.html");
      const originalContent = fs.readFileSync(sampleHtmlPath, "utf-8");
      fs.writeFileSync(sampleHtmlPath, originalContent + "\n");

      // Wait for file change to be processed
      await Bun.sleep(2000);

      // The test passes if we get here without the server crashing
      // In the bug, the server would panic and crash immediately when the file is modified
      const stderr = await proc.stderr.text();
      expect(stderr).not.toContain("panic");
      expect(stderr).not.toContain("cached asset not found");

      proc.kill();
      await proc.exited;
    },
    { timeout: 15000 },
  );
});
