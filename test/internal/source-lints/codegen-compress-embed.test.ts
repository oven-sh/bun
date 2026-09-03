/**
 * src/codegen/compress-embed.ts writes the zstd copy of an asset that release
 * builds embed. It must run with the Bun APIs disabled (see without-bun-apis.ts).
 */
import { expect, test } from "bun:test";
import { tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { zstdDecompressSync } from "node:zlib";
import { runWithoutBunApis } from "./without-bun-apis.ts";

const script = join(import.meta.dirname, "..", "..", "..", "src", "codegen", "compress-embed.ts");

test("compress-embed.ts writes a zstd frame that inflates to the input, with the Bun APIs disabled", async () => {
  const input = Buffer.alloc(64 * 1024, "export const value = 1;\n").toString();
  using dir = tempDir("compress-embed", { "asset.js": input });
  const output = join(String(dir), "compressed", "asset.js.zst");

  const { stderr, exitCode } = await runWithoutBunApis([script, join(String(dir), "asset.js"), output]);

  expect(stderr).toBe("");
  expect(zstdDecompressSync(readFileSync(output)).toString()).toBe(input);
  expect(exitCode).toBe(0);
});
