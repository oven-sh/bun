import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generate } from "../../src/http_types/mime_type_list.generate.ts";

// `MimeType::by_name_static` reads a table generated from mime_type_list.txt;
// regenerate it (`bun src/http_types/mime_type_list.generate.ts`) when the list changes.
test("mime_type_list_sorted.rs is up to date", () => {
  const dir = join(import.meta.dir, "../../src/http_types");
  const expected = generate(readFileSync(join(dir, "mime_type_list.txt"), "utf8"));
  expect(readFileSync(join(dir, "mime_type_list_sorted.rs"), "utf8")).toBe(expected);
});
