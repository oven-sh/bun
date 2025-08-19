import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDirWithFiles } from "harness";

test("namespace object should have correct prototype chain", async () => {
  const dir = tempDirWithFiles("namespace-properties", {
    "exports.mjs": `
      export const namedExport = "test";
      export default "defaultExport";
    `,
    "test.mjs": `
      import * as ns from './exports.mjs';
      
      // Check prototype chain
      const proto = Object.getPrototypeOf(ns);
      console.log("Prototype is null:", proto === null);
      console.log("Prototype has null prototype:", proto && Object.getPrototypeOf(proto) === null);
      
      // Test Object.prototype pollution doesn't affect namespace
      Object.prototype.polluted = "SHOULD_NOT_BE_ACCESSIBLE";
      
      console.log("Namespace has polluted property:", 'polluted' in ns);
      console.log("Namespace polluted value:", ns.polluted);
      
      // Verify exports are still accessible
      console.log("Named export:", ns.namedExport);
      console.log("Default export:", ns.default);
      
      // Test __esModule functionality (should be available through prototype)
      console.log("__esModule initial:", ns.__esModule);
      ns.__esModule = true;
      console.log("__esModule after set:", ns.__esModule);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), "test.mjs"],
    env: bunEnv,
    cwd: dir,
    stderr: "pipe",
    stdout: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(exitCode).toBe(0);

  // Namespace should not inherit from Object.prototype
  expect(stdout).toContain("Namespace has polluted property: false");
  expect(stdout).toContain("Namespace polluted value: undefined");

  // But original exports should work
  expect(stdout).toContain("Named export: test");
  expect(stdout).toContain("Default export: defaultExport");

  // __esModule should be settable
  expect(stdout).toContain("__esModule initial: undefined");
  expect(stdout).toContain("__esModule after set: true");
});
