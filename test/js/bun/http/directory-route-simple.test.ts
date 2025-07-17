import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles, isWindows } from "harness";
import { join } from "path";

describe("DirectoryRoute Simple", () => {
  let testDir: string;

  beforeAll(() => {
    testDir = tempDirWithFiles("directory-route-simple-test", {
      "index.html": "<html><body>Index Page</body></html>",
      "about.html": "<html><body>About Page</body></html>",
    });
    console.log("Test directory:", testDir);
  });

  it("should recognize dir routes", () => {
    console.log("Testing directory route creation...");
    
    try {
      const server = Bun.serve({
        port: 0,
        routes: {
          "/": { dir: testDir },
        },
      });
      
      console.log("Server created successfully on port:", server.port);
      console.log("Test directory exists:", Bun.file(join(testDir, "index.html")).size > 0);
      
      server.stop();
      expect(true).toBe(true); // If we get here, route creation worked
    } catch (error) {
      console.error("Error creating server:", error);
      throw error;
    }
  });

  it("should test basic file access", async () => {
    const server = Bun.serve({
      port: 0,
      routes: {
        "/": { dir: testDir },
      },
    });
    
    console.log("Server started on port:", server.port);
    
    try {
      const response = await fetch(`http://localhost:${server.port}/`);
      console.log("Response status:", response.status);
      console.log("Response headers:", Object.fromEntries(response.headers.entries()));
      
      if (response.status !== 200) {
        const text = await response.text();
        console.log("Response body:", text);
      }
      
      expect(response.status).toBe(200);
    } finally {
      server.stop();
    }
  });
});