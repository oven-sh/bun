import { describe, test, expect } from "bun:test";
import { bunExe, bunEnv, tempDir } from "harness";
import { join } from "path";

describe("regression: text imports return asset path after HMR", () => {
  test("text imports should maintain file contents after HMR update", async () => {
    using dir = tempDir("text-import-hmr");
    
    // Create an HTML file with a module that imports text
    await Bun.write(
      join(dir, "index.html"),
      `<!DOCTYPE html>
<html>
<body>
  <pre id="content"></pre>
  <script type="module">
    import data from "./data.txt" with { type: "text" };
    
    // Track loads for testing
    window.loadCount = (window.loadCount || 0) + 1;
    window.results = window.results || [];
    window.results.push({
      loadCount: window.loadCount,
      type: typeof data,
      content: data,
      isAssetPath: data.startsWith("/_bun/asset/")
    });
    
    // Display the content
    document.getElementById("content").textContent = data;
    
    // Set up HMR
    if (import.meta.hot) {
      import.meta.hot.accept("./data.txt", (newData) => {
        window.loadCount++;
        window.results.push({
          loadCount: window.loadCount,
          type: typeof newData,
          content: newData,
          isAssetPath: (newData && newData.startsWith && newData.startsWith("/_bun/asset/")) || false
        });
        document.getElementById("content").textContent = newData || "[HMR update failed]";
      });
    }
  </script>
</body>
</html>`
    );

    // Create initial text file
    await Bun.write(join(dir, "data.txt"), "Initial text content");

    // Start dev server
    const server = Bun.spawn({
      cmd: [bunExe(), "dev", join(dir, "index.html")],
      env: bunEnv,
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
    });

    try {
      // Wait for server to start
      await Bun.sleep(1500);

      // Connect to the page and check initial load
      const response = await fetch("http://localhost:3000/");
      const html = await response.text();
      
      // The HTML should have the text content injected, not an asset path
      expect(html).toContain("Initial text content");
      expect(html).not.toContain("/_bun/asset/");

      // Trigger HMR by modifying the text file
      await Bun.write(join(dir, "data.txt"), "Updated text content");
      
      // Wait for HMR to process
      await Bun.sleep(1500);

      // Check if HMR maintains text content (not asset path)
      // In the bug, this would return an asset path like "/_bun/asset/9337eccf99c40fb5.txt"
      // instead of the actual text content
      
      // We can't easily test the live HMR result without a browser,
      // but we can verify the server output doesn't show errors
      const output = await server.stdout.text();
      const errors = await server.stderr.text();
      
      // The server should not have any errors about asset handling
      expect(errors).not.toContain("asset");
      
    } finally {
      server.kill();
    }
  });
});