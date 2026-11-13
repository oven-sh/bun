import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { generate } from "../../../src/codegen/generate-webgpu-bindings.ts";

/** Without what prettier changes. */
const tokens = (text: string) =>
  text
    .replace(/0x[\dA-F]+/g, hex => hex.toLowerCase())
    .replace(/[\s,;()|]/g, "")
    .replace(/(?<=[{}:=])/g, "\n");

test.each(Object.entries(generate()).map(([path, text]) => [basename(path), path, text]))(
  "%s is what `bun src/codegen/generate-webgpu-bindings.ts` writes",
  (_, path, text) => {
    expect(tokens(readFileSync(path, "utf8"))).toBe(tokens(text));
  },
);
