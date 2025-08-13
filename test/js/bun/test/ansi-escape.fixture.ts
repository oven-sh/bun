import { expect } from "bun:test";

// Test case with ANSI escape sequences that should be escaped in diff output
expect("abc").toBe("\x1b[31mabc");