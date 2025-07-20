import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles, isWindows } from "harness";
import { join } from "path";

describe("DirectoryRoute Subpath", () => {
  let testDir: string;

  beforeAll(() => {
    testDir = tempDirWithFiles("directory-route-subpath-test", {
      "index.html": "<html><body>Root Index</body></html>",
      "about.html": "<html><body>About Page</body></html>",
      "subdir/index.html": "<html><body>Subdir Index</body></html>",
      "subdir/page.html": "<html><body>Subdir Page</body></html>",
    });
    console.log("Test directory:", testDir);
  });

  it("should handle root directory route", async () => {
    const server = Bun.serve({
      port: 0,
      routes: {
        "/": { dir: testDir },
      },
    });
    
    console.log("Server started on port:", server.port);
    
    try {
      // Test root path
      const rootResponse = await fetch(`http://localhost:${server.port}/`);
      expect(rootResponse.status).toBe(200);
      const rootText = await rootResponse.text();
      expect(rootText).toContain("Root Index");
      
      // Test sub-file
      const aboutResponse = await fetch(`http://localhost:${server.port}/about.html`);
      expect(aboutResponse.status).toBe(200);
      const aboutText = await aboutResponse.text();
      expect(aboutText).toContain("About Page");
      
      // Test sub-directory
      const subdirResponse = await fetch(`http://localhost:${server.port}/subdir/`);
      expect(subdirResponse.status).toBe(200);
      const subdirText = await subdirResponse.text();
      expect(subdirText).toContain("Subdir Index");
      
      // Test sub-directory file
      const subdirPageResponse = await fetch(`http://localhost:${server.port}/subdir/page.html`);
      expect(subdirPageResponse.status).toBe(200);
      const subdirPageText = await subdirPageResponse.text();
      expect(subdirPageText).toContain("Subdir Page");
      
    } finally {
      server.stop();
    }
  });

  it("should handle non-root directory route", async () => {
    const server = Bun.serve({
      port: 0,
      routes: {
        "/files": { dir: testDir },
      },
    });
    
    console.log("Server started on port:", server.port);
    
    try {
      // Test exact path match
      const exactResponse = await fetch(`http://localhost:${server.port}/files`);
      expect(exactResponse.status).toBe(200);
      const exactText = await exactResponse.text();
      expect(exactText).toContain("Root Index");
      
      // Test sub-file
      const fileResponse = await fetch(`http://localhost:${server.port}/files/about.html`);
      expect(fileResponse.status).toBe(200);
      const fileText = await fileResponse.text();
      expect(fileText).toContain("About Page");
      
      // Test sub-directory
      const subdirResponse = await fetch(`http://localhost:${server.port}/files/subdir/`);
      expect(subdirResponse.status).toBe(200);
      const subdirText = await subdirResponse.text();
      expect(subdirText).toContain("Subdir Index");
      
    } finally {
      server.stop();
    }
  });
});