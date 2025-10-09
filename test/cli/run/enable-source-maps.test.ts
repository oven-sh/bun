import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

test("--enable-source-maps should use user-provided inline source maps in stack traces", async () => {
  // Create a transpiled file with an inline source map
  // Original source:
  //   function throwError() {
  //     throw new Error("original error");
  //   }
  //   throwError();

  const originalSource = `function throwError() {
  throw new Error("original error");
}
throwError();`;

  // Transpiled (minified) version with inline sourcemap
  const transpiledWithSourceMap = `function a(){throw new Error("original error")}a();
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbImlucHV0LnRzIl0sInNvdXJjZXNDb250ZW50IjpbImZ1bmN0aW9uIHRocm93RXJyb3IoKSB7XG4gIHRocm93IG5ldyBFcnJvcihcIm9yaWdpbmFsIGVycm9yXCIpO1xufVxudGhyb3dFcnJvcigpOyJdLCJtYXBwaW5ncyI6IkFBQUEsU0FBQUEsSUFDRSxNQUFNLElBQUksTUFBTSxnQkFDbEIsQ0FDQUEsR0FBQSIsIm5hbWVzIjpbInRocm93RXJyb3IiXX0=`;

  using dir = tempDir("enable-source-maps", {
    "input.js": transpiledWithSourceMap,
  });

  // Test WITHOUT --enable-source-maps: should show transpiled locations
  {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "input.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(1);
    // Without --enable-source-maps, the error should reference the transpiled file
    // The error occurs at function 'a()' not 'throwError()'
    expect(stderr).toContain("input.js");
    // Stack trace should NOT show the original function name
    expect(stderr).not.toContain("throwError");
  }

  // Test WITH --enable-source-maps: should show original source locations
  {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--enable-source-maps", "input.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(1);
    // With --enable-source-maps, the error should reference the original source
    expect(stderr).toContain("input.ts");
    // Stack trace SHOULD show the original function name
    expect(stderr).toContain("throwError");
  }
});

test("--enable-source-maps should use external source map files", async () => {
  // Create a file with an external source map reference
  const transpiledCode = `function a(){throw new Error("test error")}a();
//# sourceMappingURL=output.js.map`;

  // Create the external source map file
  const sourceMap = {
    version: 3,
    sources: ["original.ts"],
    sourcesContent: ['function throwError() {\n  throw new Error("test error");\n}\nthrowError();'],
    mappings: "AAAA,SAASA,IACE,MAAM,IAAI,MAAM,aAClB,CACAA,GAAA",
    names: ["throwError"],
  };

  using dir = tempDir("enable-source-maps-external", {
    "output.js": transpiledCode,
    "output.js.map": JSON.stringify(sourceMap),
  });

  // Test WITHOUT --enable-source-maps
  {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "output.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("output.js");
    expect(stderr).not.toContain("original.ts");
  }

  // Test WITH --enable-source-maps
  {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--enable-source-maps", "output.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(1);
    // With --enable-source-maps, should reference original source
    expect(stderr).toContain("original.ts");
    expect(stderr).toContain("throwError");
  }
});

test("--enable-source-maps should work with findSourceMap from node:module", async () => {
  const code = `import { findSourceMap } from "node:module";

const sourceMap = findSourceMap(import.meta.path);

if (!sourceMap) {
  console.error("No source map found");
  process.exit(1);
}

console.log("Source map found!");
console.log("Has payload:", !!sourceMap.payload);
console.log("Has findEntry:", typeof sourceMap.findEntry === "function");
process.exit(0);
`;

  const transpiledWithSourceMap = `import{findSourceMap as a}from"node:module";const b=a(import.meta.path);if(!b){console.error("No source map found");process.exit(1)}console.log("Source map found!");console.log("Has payload:",!!b.payload);console.log("Has findEntry:",typeof b.findEntry==="function");process.exit(0);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbInRlc3QudHMiXSwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0IHsgZmluZFNvdXJjZU1hcCB9IGZyb20gXCJub2RlOm1vZHVsZVwiO1xuXG5jb25zdCBzb3VyY2VNYXAgPSBmaW5kU291cmNlTWFwKGltcG9ydC5tZXRhLnBhdGgpO1xuXG5pZiAoIXNvdXJjZU1hcCkge1xuICBjb25zb2xlLmVycm9yKFwiTm8gc291cmNlIG1hcCBmb3VuZFwiKTtcbiAgcHJvY2Vzcy5leGl0KDEpO1xufVxuXG5jb25zb2xlLmxvZyhcIlNvdXJjZSBtYXAgZm91bmQhXCIpO1xuY29uc29sZS5sb2coXCJIYXMgcGF5bG9hZDpcIiwgISFzb3VyY2VNYXAucGF5bG9hZCk7XG5jb25zb2xlLmxvZyhcIkhhcyBmaW5kRW50cnk6XCIsIHR5cGVvZiBzb3VyY2VNYXAuZmluZEVudHJ5ID09PSBcImZ1bmN0aW9uXCIpO1xucHJvY2Vzcy5leGl0KDApOyJdLCJtYXBwaW5ncyI6IkFBQUEsT0FBT0EsT0FBQUEsZUFBQUEsS0FBQSxlQUFBLENBRVAsTUFBTUMsRUFBQUQsRUFBQUEsT0FBQUEsS0FBQUEsS0FBQSxLQUFBLENBRUEsR0FBQSxDQUFBQyxFQUFBLENBQ0EsUUFBQSxNQUFBLHFCQUFBLEVBQ0EsUUFBQSxLQUFBLEVBQUEsQ0FDQSxDQUVBLFFBQUEsSUFBQSxvQkFBQSxFQUNBLFFBQUEsSUFBQSxlQUFBLENBQUEsQ0FBQUEsRUFBQSxRQUFBLEVBQ0EsUUFBQSxJQUFBLGdCQUFBLE9BQU9BLEVBQUEsV0FBQSxXQUFBLEVBQ1AsUUFBQSxLQUFBLEVBQUEiLCJuYW1lcyI6WyJmaW5kU291cmNlTWFwIiwic291cmNlTWFwIl19`;

  using dir = tempDir("enable-source-maps-api", {
    "test.js": transpiledWithSourceMap,
  });

  // Test WITHOUT --enable-source-maps: should not find source map
  {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(1);
    expect(stderr).toContain("No source map found");
  }

  // Test WITH --enable-source-maps: should find source map
  {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--enable-source-maps", "test.js"],
      env: bunEnv,
      cwd: String(dir),
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("Source map found!");
    expect(stdout).toContain("Has payload: true");
    expect(stdout).toContain("Has findEntry: function");
  }
});
