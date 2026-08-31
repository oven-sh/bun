// Checks node:path against outputs recorded from Node.js for a corpus of generated
// inputs (mixed separators, drive letters, UNC and \\?\ prefixes, reserved device
// names, non-Latin-1 and astral characters). Every case here is independent of
// process.cwd().
//
// The corpus lives in node-path-parity.json as [namespace, fn, args, expected]
// where `expected` is a string/boolean, a parse() object, or { error: { code, message } };
// regenerate it with `node node-path-parity.gen.mjs > node-path-parity.json`.
import { describe, expect, test } from "bun:test";
import path from "node:path";
import fixture from "./node-path-parity.json" with { type: "json" };

type Row = ["posix" | "win32", string, unknown[], unknown];

describe("node:path matches Node.js", () => {
  const rows = fixture as Row[];
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = `${row[0]}.${row[1]}`;
    let list = groups.get(key);
    if (!list) groups.set(key, (list = []));
    list.push(row);
  }

  for (const [key, list] of groups) {
    test(`${key} (${list.length} cases)`, () => {
      for (const [ns, fn, args, expected] of list) {
        const impl = path[ns][fn];
        if (expected && typeof expected === "object" && "error" in (expected as object)) {
          const { code, message } = (expected as { error: { code: string; message: string } }).error;
          let thrown: unknown;
          try {
            impl(...args);
          } catch (e) {
            thrown = e;
          }
          expect(thrown, `${key}(${JSON.stringify(args)})`).toMatchObject({ code, message });
        } else {
          expect(impl(...args), `${key}(${JSON.stringify(args)})`).toEqual(expected);
        }
      }
    });
  }
});
