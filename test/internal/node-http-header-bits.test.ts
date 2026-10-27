import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// node:_http_outgoing sets the bits of `headerBits` of an exchange, and node:_http_server tests them.
test("one module numbers the bits of the headers of a response", () => {
  const read = (module: string) => readFileSync(join(import.meta.dir, "..", "..", "src", "js", module), "utf8");
  const declared = (module: string) =>
    [...read(module).matchAll(/^const (HEADER_\w+) = (.*);$/gm)].map(([, name, value]) => [name, value]);
  const numbered = declared("internal/http.ts");
  expect(numbered.map(([, value]) => value)).toEqual(Array.from({ length: 7 }, (_, index) => `1 << ${index}`));
  for (const module of ["node/_http_outgoing.ts", "node/_http_server.ts"]) {
    expect(declared(module).slice(0, 7)).toEqual(numbered.map(([name]) => [name, `http.${name}`]));
    expect(declared(module).filter(([, value]) => /\d/.test(value))).toEqual([]);
  }
});
