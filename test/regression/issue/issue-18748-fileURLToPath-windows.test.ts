import { expect, test } from "bun:test";
import { isWindows } from "harness";
import { fileURLToPath, pathToFileURL } from "node:url";

test("fileURLToPath should handle paths starting with / correctly on all platforms", () => {
  const testPaths = ["/test", "/@test", "/node_modules/test", "/@solid-refresh"];

  for (const testPath of testPaths) {
    const url = pathToFileURL(testPath);

    if (isWindows) {
      expect(url.href).toMatch(/^file:\/\/\/[A-Z]:\//);
    } else {
      expect(url.href).toBe(`file://${testPath}`);
    }

    const result = fileURLToPath(url);

    if (isWindows) {
      expect(result).toMatch(/^[A-Z]:\\/);
      expect(result.toLowerCase()).toContain(testPath.replace(/\//g, "\\").toLowerCase());
    } else {
      expect(result).toBe(testPath);
    }
  }
});

test.if(isWindows)("Windows absolute paths should still work correctly", () => {
  const absolutePaths = ["C:\\test", "C:\\Users\\test", "D:\\Projects\\myapp", "\\\\server\\share\\file"];

  for (const absolutePath of absolutePaths) {
    const url = pathToFileURL(absolutePath);
    const result = fileURLToPath(url);

    expect(result).toBe(absolutePath);
  }
});
