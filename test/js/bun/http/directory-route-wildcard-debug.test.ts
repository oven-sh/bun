import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles, isWindows } from "harness";
import { join } from "path";

describe("DirectoryRoute Wildcard Debug", () => {
  let testDir: string;

  beforeAll(() => {
    testDir = tempDirWithFiles("directory-route-wildcard-debug", {
      "index.html": "<html><body>Root Index</body></html>",
      "test.html": "<html><body>Test Page</body></html>",
    });
    console.log("Test directory:", testDir);
  });

  it("should debug wildcard behavior", async () => {
    const server = Bun.serve({
      port: 0,
      routes: {
        "/": { dir: testDir },
      },
    });
    
    console.log("Server started on port:", server.port);
    
    try {
      // Test root path (this should work)
      console.log("Testing /");
      const rootResponse = await fetch(`http://localhost:${server.port}/`);
      console.log("/ status:", rootResponse.status);
      
      // Test simple file (this should work with wildcard)
      console.log("Testing /test.html");
      const testResponse = await fetch(`http://localhost:${server.port}/test.html`);
      console.log("/test.html status:", testResponse.status);
      
      if (testResponse.status !== 200) {
        const text = await testResponse.text();
        console.log("/test.html response body:", text);
      }
      
    } finally {
      server.stop();
    }
  });
});