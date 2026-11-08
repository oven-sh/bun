import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// A built-in module declares the flags it tests itself, as a `const enum` or as `const NAME = 1 << 0;`, so that each use is
// a number in the bundled module. What one module writes into an object another one tests, so a name that several modules
// declare has to have one value.

const root = path.resolve(import.meta.dir, "..", "..", "..", "src", "js");

// The bits that belong to a ReadableState or to a WritableState alone.
const differsOnPurpose = {
  "Flag.DefaultUTF8Encoding": [
    "ahead-of-time/internal/streams/readable.ts",
    "ahead-of-time/internal/streams/writable.ts",
  ],
  "Flag.Ended": ["ahead-of-time/internal/streams/readable.ts", "ahead-of-time/internal/streams/writable.ts"],
  "Flag.Sync": ["ahead-of-time/internal/streams/readable.ts", "ahead-of-time/internal/streams/writable.ts"],
};

function declaredConstants() {
  const constants = new Map<string, Map<string, string[]>>();
  const add = (name: string, value: string, file: string) => {
    if (!constants.has(name)) constants.set(name, new Map());
    const files = constants.get(name)!;
    files.set(value, [...(files.get(value) ?? []), file]);
  };
  for (const entry of (readdirSync(root, { recursive: true }) as string[]).sort()) {
    if (!entry.endsWith(".ts") || entry.endsWith(".d.ts")) continue;
    const file = entry.replaceAll("\\", "/");
    let enumName: string | undefined;
    for (const line of readFileSync(path.join(root, entry), "utf8").split(/\r?\n/)) {
      let match: RegExpExecArray | null;
      if ((match = /^(?:export )?const enum (\w+) \{$/.exec(line))) enumName = match[1];
      else if (line === "}") enumName = undefined;
      else if (enumName && (match = /^  (\w+) = ([^,]+),/.exec(line))) add(`${enumName}.${match[1]}`, match[2], file);
      else if ((match = /^const ([A-Z][A-Z0-9_]+) = ([\w |<()~&+*-]+);$/.exec(line)) && /^[\d(~-]|<<|\|/.test(match[2]))
        add(match[1], match[2], file);
    }
  }
  return constants;
}

test("a constant that several built-in modules declare has one value", () => {
  const constants = declaredConstants();
  expect(constants.get("ESCAPE_CODE_TIMEOUT")).toEqual(
    new Map([
      [
        "500",
        [
          "ahead-of-time/internal/readline/emitKeypressEvents.ts",
          "ahead-of-time/internal/readline/interface.ts",
          "internal/readline/emitKeypressEvents.ts",
          "internal/readline/interface.ts",
        ],
      ],
    ]),
  );

  const differing: Record<string, string[]> = {};
  for (const [name, files] of [...constants].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (files.size > 1) differing[name] = [...files.values()].flat().sort();
  }
  expect(differing).toEqual(differsOnPurpose);
});
