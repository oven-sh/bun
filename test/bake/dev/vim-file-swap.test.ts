import { expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { devTest } from "../bake-harness";

devTest("vim file swap hot reload for entrypoints", {
  files: {
    "index.html": `<!DOCTYPE html>
<head>
  <title>Test</title>
</head>
<body>
  <p>Test foo</p>
  <script type="module" src="index.ts"></script>
</body>`,
    "index.ts": ``,
  },
  async test(dev) {
    await using c = await dev.client("/");

    // Verify initial load works
    const initialResponse = await dev.fetch("/");
    expect(initialResponse.status).toBe(200);
    const initialText = await initialResponse.text();
    expect(initialText).toContain("Test foo");

    // Simulate vim-style file editing multiple times to increase reliability
    for (let i = 0; i < 3; i++) {
      const updatedContent = `<!DOCTYPE html>
<head>
  <title>Test</title>
</head>
<body>
  <p>Test bar ${i + 1}</p>
  <script type="module" src="index.ts"></script>
</body>`;

      // Step 1: Create .index.html.swp file with new content
      const swapFile = path.join(dev.rootDir, ".index.html.swp");
      await Bun.file(swapFile).write(updatedContent);

      // Step 2: Delete original index.html
      const originalFile = path.join(dev.rootDir, "index.html");
      fs.unlinkSync(originalFile);

      // Step 3: Rename .index.html.swp to index.html (atomic operation)
      fs.renameSync(swapFile, originalFile);

      // Wait a bit for file watcher to detect changes
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify the content was updated
      const response = await dev.fetch("/");
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain(`Test bar ${i + 1}`);
    }
  },
});
