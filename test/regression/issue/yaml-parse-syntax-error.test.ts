import { YAML } from "bun";
import { expect, test } from "bun:test";

test("YAML.parse throws SyntaxError like JSON.parse", () => {
  // Test that YAML.parse throws a SyntaxError for invalid YAML
  try {
    YAML.parse("[ invalid");
    throw new Error("Should have thrown");
  } catch (e) {
    expect(e).toBeInstanceOf(SyntaxError);
    expect(e.constructor.name).toBe("SyntaxError");
    expect(e.message).toContain("YAML Parse error");
  }

  // Test with another invalid YAML
  try {
    YAML.parse("{ key: value");
    throw new Error("Should have thrown");
  } catch (e) {
    expect(e).toBeInstanceOf(SyntaxError);
    expect(e.constructor.name).toBe("SyntaxError");
    expect(e.message).toContain("YAML Parse error");
  }

  // Test with invalid YAML structure
  try {
    YAML.parse(":\n :  - invalid");
    throw new Error("Should have thrown");
  } catch (e) {
    expect(e).toBeInstanceOf(SyntaxError);
    expect(e.constructor.name).toBe("SyntaxError");
    expect(e.message).toContain("YAML Parse error");
  }

  // Compare with JSON.parse behavior
  try {
    JSON.parse("{ invalid");
    throw new Error("Should have thrown");
  } catch (e) {
    expect(e).toBeInstanceOf(SyntaxError);
    expect(e.constructor.name).toBe("SyntaxError");
    expect(e.message).toContain("JSON Parse error");
  }
});
