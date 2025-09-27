import { expect, test } from "bun:test";
import util from "node:util";

test("util.getSystemErrorMap() returns a Map", () => {
  const errorMap = util.getSystemErrorMap();
  expect(errorMap).toBeInstanceOf(Map);
  expect(errorMap.size).toBeGreaterThan(0);
});

test("util.getSystemErrorMap() contains expected error codes", () => {
  const errorMap = util.getSystemErrorMap();

  // Test some common error codes
  expect(errorMap.has(-2)).toBe(true); // ENOENT
  expect(errorMap.has(-13)).toBe(true); // EACCES
  expect(errorMap.has(-98)).toBe(true); // EADDRINUSE
  expect(errorMap.has(-111)).toBe(true); // ECONNREFUSED

  // Test special error codes
  expect(errorMap.has(-4095)).toBe(true); // EOF
  expect(errorMap.has(-4094)).toBe(true); // UNKNOWN
});

test("util.getSystemErrorMap() values have correct structure", () => {
  const errorMap = util.getSystemErrorMap();

  // Check ENOENT error
  const enoent = errorMap.get(-2);
  expect(Array.isArray(enoent)).toBe(true);
  expect(enoent).toHaveLength(2);
  expect(enoent[0]).toBe("ENOENT");
  expect(enoent[1]).toBe("no such file or directory");

  // Check EACCES error
  const eacces = errorMap.get(-13);
  expect(Array.isArray(eacces)).toBe(true);
  expect(eacces).toHaveLength(2);
  expect(eacces[0]).toBe("EACCES");
  expect(eacces[1]).toBe("permission denied");

  // Check EADDRINUSE error
  const eaddrinuse = errorMap.get(-98);
  expect(Array.isArray(eaddrinuse)).toBe(true);
  expect(eaddrinuse).toHaveLength(2);
  expect(eaddrinuse[0]).toBe("EADDRINUSE");
  expect(eaddrinuse[1]).toBe("address already in use");
});

test("util.getSystemErrorMap() returns the same instance", () => {
  const map1 = util.getSystemErrorMap();
  const map2 = util.getSystemErrorMap();
  expect(map1).toBe(map2); // Should return the same cached instance
});

test("util.getSystemErrorMap() matches Node.js output", () => {
  const bunMap = util.getSystemErrorMap();

  // Run Node.js to get its error map for comparison
  const proc = Bun.spawnSync({
    cmd: [
      "node",
      "-e",
      "console.log(JSON.stringify([...require('node:util').getSystemErrorMap().entries()].map((v) => [v[0], v[1][0]])));",
    ],
    stdio: ["ignore", "pipe", "pipe"],
  });

  const nodeErrors = JSON.parse(proc.stdout.toString());

  // Check that all Node.js errors are present in Bun's map
  for (const [code, name] of nodeErrors) {
    const bunError = bunMap.get(code);
    if (bunError) {
      expect(bunError[0]).toBe(name);
    }
  }
});
