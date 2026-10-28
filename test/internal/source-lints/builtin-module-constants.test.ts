import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

// A built-in module declares the flags it tests itself, as a `const enum` or as `const NAME = 1 << 0;`, so that each use is
// a number in the bundled module. What one module writes into an object another one tests, so a name that several modules
// declare has to have one value.

const root = path.resolve(import.meta.dir, "..", "..", "..", "src", "js");

// The bits that belong to a ReadableState or to a WritableState alone.
const differsOnPurpose = {
  "Flag.DefaultUTF8Encoding": ["internal/streams/readable.ts", "internal/streams/writable.ts"],
  "Flag.Ended": ["internal/streams/readable.ts", "internal/streams/writable.ts"],
  "Flag.Sync": ["internal/streams/readable.ts", "internal/streams/writable.ts"],
};

const sources = (readdirSync(root, { recursive: true }) as string[])
  .filter(entry => entry.endsWith(".ts") && !entry.endsWith(".d.ts"))
  .sort()
  .map(entry => [entry.replaceAll("\\", "/"), readFileSync(path.join(root, entry), "utf8")] as const);

function declaredConstants() {
  const constants = new Map<string, Map<string, string[]>>();
  const add = (name: string, value: string, file: string) => {
    if (!constants.has(name)) constants.set(name, new Map());
    const files = constants.get(name)!;
    files.set(value, [...(files.get(value) ?? []), file]);
  };
  for (const [file, source] of sources) {
    let enumName: string | undefined;
    for (const line of source.split(/\r?\n/)) {
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
  expect(constants.get("HEADER_DATE")).toEqual(
    new Map([["1 << 0", ["ahead-of-time/node/_http_outgoing.ts", "ahead-of-time/node/_http_server.ts"]]]),
  );

  const differing: Record<string, string[]> = {};
  for (const [name, files] of [...constants].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (files.size > 1) differing[name] = [...files.values()].flat().sort();
  }
  expect(differing).toEqual(differsOnPurpose);
});

// Two members of one enum that have one value read as each other. TypeScript allows that, and `bun lint` compares only
// the values written as a literal, so `1 << 9` twice passes both. It is what a merge gives when it keeps both sides of
// two changes that each added a flag on the next free bit.

type Value = number | string | undefined;

// A member's value, in the forms that src/js writes one: left out, a number, a string, `1 << N` or an OR of members.
function valueOf(text: string | undefined, previous: Value, values: Map<string, Value>): Value {
  if (text === undefined) return typeof previous === "number" ? previous + 1 : undefined;
  if (/^"[^"]*"$/.test(text)) return text;
  if (!Number.isNaN(Number(text))) return Number(text);
  const shift = /^(\d+) << (\d+)$/.exec(text);
  if (shift) return Number(shift[1]) << Number(shift[2]);
  const bits = text.split(" | ").map(name => values.get(name));
  if (bits.every(bit => typeof bit === "number")) return bits.reduce((all, bit) => all | bit, 0);
}

function readEnums(source: string) {
  const problems: string[] = [];
  let members = 0;
  for (const header of source.matchAll(/^[ \t]*(?:\w+\s+)*enum\s+(\w+)\s*\{/gm)) {
    // The body ends at the first `}` that is not in a comment.
    const afterHeader = source.slice(header.index + header[0].length);
    const [body] = afterHeader.replace(/\/\/.*|\/\*[^]*?\*\//g, "").split("}", 1);
    const enumName = header[1];
    const values = new Map<string, Value>();
    let previous: Value = -1;
    for (const member of body.split(",")) {
      const written = member.trim().replace(/\s+/g, " ");
      if (!written) continue;
      members++;
      const [, name = "", text] = /^(\w+)(?: = (.+))?$/.exec(written) ?? [];
      previous = name ? valueOf(text, previous, values) : undefined;
      const same = [...values].find(([, value]) => value === previous)?.[0];
      if (previous === undefined) problems.push(`${enumName}: cannot read \`${written}\``);
      else if (same) problems.push(`${enumName}: \`${written}\` has the value of \`${same}\``);
      values.set(name, previous);
    }
  }
  return { members, problems };
}

test("the members of an enum in a built-in module have different values", () => {
  const sample = `
export const enum Flag {
  Closed = 1 << 3,
  Delivered = 1 << 8, // 100000000 = 256
  // Two changes each added a flag on the next free bit, and the merge kept both.
  Destroyed = 1 << 9,
  Recorded = 1 << 9,
  ClosedOrDelivered = Closed | Delivered,
  NotClosed = ~Closed,
}
function family() {
  enum Family {
    IPv4 = "ipv4",
    Default = "ipv4",
  }
}`;
  expect(readEnums(sample)).toEqual({
    members: 8,
    problems: [
      "Flag: `Recorded = 1 << 9` has the value of `Destroyed`",
      "Flag: cannot read `NotClosed = ~Closed`",
      'Family: `Default = "ipv4"` has the value of `IPv4`',
    ],
  });

  const problems: string[] = [];
  let members = 0;
  for (const [file, source] of sources) {
    const read = readEnums(source);
    members += read.members;
    problems.push(...read.problems.map(problem => `${file}: ${problem}`));
  }
  // Give the later of two members with one value a free value, and teach `valueOf` a form that it cannot read.
  // Only a member that has the value of another one on purpose goes in this list.
  expect(problems).toEqual([]);
  expect(members).toBeGreaterThan(100);
});
