import { test, expect } from "bun:test";
import { readFileSync, writeFileSync } from "fs";
// @ts-expect-error
const highlighter: (code: string) => string = globalThis[Symbol.for("Bun.lazy")]("unstable_syntaxHighlight");

// TODO: write tests for syntax highlighting
test("highlighter", () => {});
