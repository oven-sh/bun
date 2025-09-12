import { test, expect } from "bun:test";
import { tempDir } from "harness";

test("Bun.build should validate that define keys are valid JavaScript identifiers", async () => {
  using dir = tempDir("define-validation", {
    "entry.js": `console.log("test");`,
  });

  // Test invalid identifiers
  const invalidCases = [
    ["123invalid", "starts with number"],
    ["invalid-name", "contains hyphen"],
    ["invalid.name", "contains dot"],
    ["invalid name", "contains space"],
    // Note: empty string is silently skipped by the property iterator
  ];

  for (const [invalidId, description] of invalidCases) {
    let errorThrown = false;
    let errorMessage = "";
    
    try {
      await Bun.build({
        entrypoints: [`${dir}/entry.js`],
        define: {
          [invalidId]: '"test"',
        },
        outdir: `${dir}/out`,
      });
    } catch (err) {
      errorThrown = true;
      errorMessage = err.message;
    }
    
    expect(errorThrown).toBe(true);
    expect(errorMessage).toContain(`define "${invalidId}" is not a valid JavaScript identifier`);
  }

  // Test valid identifiers
  const validIdentifiers = [
    "validName",
    "_private",
    "$jquery",
    "CONSTANT",
    "camelCase",
    "snake_case",
    "PascalCase",
    "a123",
    "_",
    "$",
    "ñ", // Unicode letter
    "日本語", // Unicode identifiers
  ];

  for (const validId of validIdentifiers) {
    const result = await Bun.build({
      entrypoints: [`${dir}/entry.js`],
      define: {
        [validId]: '"test"',
      },
      outdir: `${dir}/out-${validId}`,
    });
    
    expect(result.success).toBe(true);
    expect(result.logs).toHaveLength(0);
  }
});