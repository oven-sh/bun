const { expect, test } = require("bun:test");
const Module = require("node:module");
const path = require("node:path");

// This behavior is required for Next.js to work
test("Module._resolveFilename overwrite", () => {
  let assertions = 0;
  const old = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, isMain) {
    expect(request.endsWith("💔")).toBe(true);
    assertions++;
    expect(parent.filename).toBe(path.join(__dirname, "./resolveFilenameOverwrite.cjs"));
    assertions++;
    expect(isMain).toBe(true);
    assertions++;
    expect(this).toBe(Module);
    assertions++;
    return path.join(__dirname, "./resolveFilenameOverwrite-fixture.cjs");
  };
  const result = require("overwriting _resolveFilename broke 💔");
  Module._resolveFilename = old;
  expect(result).toBe("winner");
  assertions++;
  // TODO: Replace with `expect.assertions(3)` once implemented.
  expect(assertions).toBe(5);
});
