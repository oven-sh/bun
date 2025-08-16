import { expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { devTest } from "../bake-harness";

// Helper function to safely perform vim-style atomic write
async function vimAtomicWrite(filePath: string, content: string): Promise<void> {
  const dir = path.dirname(filePath);
  const fileName = path.basename(filePath);
  const swapFile = path.join(dir, `.${fileName}.swp`);
  
  try {
    // Step 1: Write to swap file
    await Bun.file(swapFile).write(content);
    
    // Step 2: Delete original file
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    
    // Step 3: Atomic rename
    fs.renameSync(swapFile, filePath);
  } catch (error) {
    // Clean up swap file if something went wrong
    if (fs.existsSync(swapFile)) {
      try {
        fs.unlinkSync(swapFile);
      } catch {
        // Ignore cleanup errors
      }
    }
    throw error;
  }
}

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

      await c.expectReload(async () => {
        const filePath = path.join(dev.rootDir, "index.html");
        await vimAtomicWrite(filePath, updatedContent);
      });

      // Verify the content was updated
      const response = await dev.fetch("/");
      expect(response.status).toBe(200);
      const text = await response.text();
      expect(text).toContain(`Test bar ${i + 1}`);
    }
  },
});
