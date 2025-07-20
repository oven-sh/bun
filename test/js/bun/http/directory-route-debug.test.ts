import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles, isWindows } from "harness";
import { join } from "path";
import { readdirSync } from "fs";

describe("DirectoryRoute Debug", () => {
  let testDir: string;

  beforeAll(() => {
    testDir = tempDirWithFiles("directory-route-debug", {
      "test.html": "<html><body>Test Content</body></html>",
    });
    console.log("Debug Test directory:", testDir);
    console.log("Files in directory:", readdirSync(testDir));
  });

  it("should debug single file serving", async () => {
    const server = Bun.serve({
      port: 0,
      routes: {
        "/": { dir: testDir },
      },
    });
    
    console.log("Server started on port:", server.port);
    console.log("Testing file at path: /test.html");
    
    try {
      const response = await fetch(`http://localhost:${server.port}/test.html`);
      console.log("Response status:", response.status);
      console.log("Response headers:", Object.fromEntries(response.headers.entries()));
      
      if (response.status !== 200) {
        const text = await response.text();
        console.log("Response body:", text);
        
        // Also test if file exists directly
        const testFilePath = join(testDir, "test.html");
        console.log("Direct file check:", Bun.file(testFilePath).size);
      } else {
        const text = await response.text();
        console.log("Success! Response body:", text);
      }
      
      expect(response.status).toBe(200);
    } finally {
      server.stop();
    }
  });
});