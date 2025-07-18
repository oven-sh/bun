import { describe, test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { join } from "path";
import { tmpdir } from "os";
import { mkdirSync, writeFileSync, rmSync } from "fs";

// Regression test for crash in DevServer.zig:4186
// "panic: Assertion failure: null != 62"
// This happens when edges are disconnected from the dependency list 
// but the assertion incorrectly assumes the edge is still the first dependency
describe("DevServer edge disconnect crash", () => {
  test("should handle rapid import changes without crashing", async () => {
    const tempDir = join(tmpdir(), "bun-test-devserver-edge-crash-" + Math.random().toString(36));
    
    try {
      mkdirSync(tempDir, { recursive: true });

      // Create initial files with dependencies
      const indexPath = join(tempDir, "index.tsx");
      const componentPath = join(tempDir, "component.tsx");
      const utilsPath = join(tempDir, "utils.ts");
      
      writeFileSync(indexPath, `
import Component from "./component";
import { helper } from "./utils";

export default function App() {
  return <Component value={helper()} />;
}
`);

      writeFileSync(componentPath, `
import { helper } from "./utils";

export default function Component({ value }: { value: string }) {
  return <div>{value} - {helper()}</div>;
}
`);

      writeFileSync(utilsPath, `
export function helper() {
  return "hello";
}
`);

      // Start the dev server
      const proc = Bun.spawn({
        cmd: [bunExe(), "--bun", "build", "--dev", indexPath],
        cwd: tempDir,
        env: bunEnv,
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
      });

      // Wait briefly for initial build
      await Bun.sleep(100);

      // Now rapidly change the imports to trigger edge disconnection
      // Remove import from component.tsx
      writeFileSync(componentPath, `
export default function Component({ value }: { value: string }) {
  return <div>{value}</div>;
}
`);

      await Bun.sleep(50);

      // Add it back
      writeFileSync(componentPath, `
import { helper } from "./utils";

export default function Component({ value }: { value: string }) {
  return <div>{value} - {helper()}</div>;
}
`);

      await Bun.sleep(50);

      // Remove from both files
      writeFileSync(indexPath, `
import Component from "./component";

export default function App() {
  return <Component value="test" />;
}
`);

      writeFileSync(componentPath, `
export default function Component({ value }: { value: string }) {
  return <div>{value}</div>;
}
`);

      await Bun.sleep(50);

      // Add back to just one file
      writeFileSync(indexPath, `
import Component from "./component";
import { helper } from "./utils";

export default function App() {
  return <Component value={helper()} />;
}
`);

      await Bun.sleep(100);

      // Terminate the process
      proc.kill();
      await proc.exited;

      const stderr = await new Response(proc.stderr).text();
      
      // The test passes if there's no assertion failure crash
      expect(stderr).not.toContain("Assertion failure: null != 62");
      expect(stderr).not.toContain("panic");
      
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 10000); // 10 second timeout
});