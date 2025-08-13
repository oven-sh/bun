import { expect, test } from "bun:test";

test("ANSI escape sequences are properly handled in string comparisons", () => {
  // Test that when a comparison fails with ANSI sequences, they are properly escaped in diff output
  const expected = "plain text";
  const received = "\x1b[31mred text\x1b[0m";
  
  try {
    expect(received).toBe(expected);
  } catch (error) {
    const message = error.message;
    
    // The error message should contain escaped sequences \\x1b instead of raw escape characters
    expect(message).toContain("\\x1b");
    
    // Verify that raw escape characters are not present in the error message
    // (Note: the error message should not contain the actual escape character)
    expect(message).not.toContain("\x1b");
  }
});

test("Multiple ANSI escape sequences are all escaped", () => {
  const expected = "normal text";
  const received = "\x1b[31mred\x1b[32mgreen\x1b[34mblue\x1b[0mreset";
  
  try {
    expect(received).toBe(expected);
  } catch (error) {
    const message = error.message;
    
    // Should contain multiple escaped sequences
    const escapedCount = (message.match(/\\x1b/g) || []).length;
    expect(escapedCount).toBeGreaterThan(0);
    
    // Should not contain any raw escape characters
    expect(message).not.toContain("\x1b");
  }
});

test("Normal strings without ANSI sequences still work", () => {
  try {
    expect("hello").toBe("world");
  } catch (error) {
    const message = error.message;
    
    // Should contain the normal text
    expect(message).toContain("hello");
    expect(message).toContain("world");
    
    // Should not contain any escape sequences at all
    expect(message).not.toContain("\\x1b");
    expect(message).not.toContain("\x1b");
  }
});