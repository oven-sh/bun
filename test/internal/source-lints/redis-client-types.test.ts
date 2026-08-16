import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import valkeyClasses from "../../../src/runtime/valkey_jsc/valkey.classes.ts";

// `class RedisClient` in packages/bun-types/redis.d.ts is a hand-written mirror
// of the `proto` table in src/runtime/valkey_jsc/valkey.classes.ts, which is
// what the class codegen installs on RedisClient.prototype. Nothing else
// compares the two: five commands registered by the first Bun.redis commit were
// still undeclared fourteen redis.d.ts commits later, so calling them works at
// runtime and fails to type-check. This lint loads the same module the codegen
// loads and requires the class body to declare exactly the members the tables
// install.

// Registered members that are not declared yet, each with the open PR that
// declares it. Delete the entry when that PR lands: the lint fails while a name
// listed here is declared (or is no longer registered).
const pendingDeclarations: Record<string, string> = {
  pubsub: "#39208",
  select: "#39208",
  script: "#29339",
  // Not usable until #35521 lands: psubscribe() takes no listener today, so
  // every pmessage the server sends is dropped.
  psubscribe: "#35521",
  punsubscribe: "#35521",
};

const classesFile = "src/runtime/valkey_jsc/valkey.classes.ts";
const dtsFile = "packages/bun-types/redis.d.ts";
const root = path.resolve(import.meta.dir, "..", "..", "..");

const definition = valkeyClasses.find(c => c.name === "RedisClient");
if (definition === undefined) throw new Error(`${classesFile} no longer defines RedisClient`);

// Every member the codegen installs: prototype members by name, `klass` (static)
// members as "static name". A well-known symbol stays in the table's `@@x`
// spelling; parseClassBody maps the class body's `[Symbol.x]` onto it.
const registered = new Set<string>();
for (const [table, prefix] of [
  [definition.proto, ""],
  [definition.klass, "static "],
] as const) {
  for (const [name, field] of Object.entries(table)) {
    // Installed under a private name or a Symbol.for() symbol, or (internal)
    // not installed at all; none of these has a declaration to mirror.
    if ("internal" in field || "privateSymbol" in field || "publicSymbol" in field) continue;
    registered.add(prefix + name);
  }
}
if (definition.construct) registered.add("constructor");

const { declared, unrecognized } = parseClassBody(readFileSync(path.join(root, dtsFile), "utf8"));

function parseClassBody(dts: string): { declared: Set<string>; unrecognized: string[] } {
  const open = /^  export class RedisClient \{$/m.exec(dts);
  if (open === null) throw new Error(`${dtsFile} no longer declares \`export class RedisClient {\``);
  const bodyStart = open.index + open[0].length;
  const bodyEnd = dts.indexOf("\n  }\n", bodyStart);
  if (bodyEnd === -1) throw new Error(`${dtsFile}: unterminated class RedisClient body`);

  const body = dts
    .slice(bodyStart, bodyEnd)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");

  const declared = new Set<string>();
  const unrecognized: string[] = [];
  // Members start at the class body's four-space indent. The only other lines
  // at that indent are the `): ...;` closers of multi-line signatures, which
  // start with punctuation, so everything else at that indent is a member and
  // has to parse: a declaration shape this does not know is reported rather
  // than skipped.
  const member = /^(static )?(?:readonly )?(?:(?:get|set) )?(?:\[Symbol\.(\w+)\]|([A-Za-z_$][\w$]*))\s*\??\s*[(:<]/;
  for (const [line] of body.matchAll(/^    [^\s)\]}>].*$/gm)) {
    const m = member.exec(line.slice(4));
    if (m === null) {
      unrecognized.push(line.trim());
      continue;
    }
    const name = m[2] !== undefined ? `@@${m[2]}` : m[3];
    declared.add((m[1] ?? "") + name);
  }
  return { declared, unrecognized };
}

test(`every member of class RedisClient in ${dtsFile} has a shape this lint can read`, () => {
  expect(unrecognized).toEqual([]);
});

test(`${dtsFile} declares every RedisClient member ${classesFile} installs`, () => {
  const undeclared = [...registered]
    .filter(name => !declared.has(name) && !Object.hasOwn(pendingDeclarations, name))
    .sort();
  expect(undeclared).toEqual([]);
});

test(`${dtsFile} declares no RedisClient member ${classesFile} does not install`, () => {
  const phantom = [...declared].filter(name => !registered.has(name)).sort();
  expect(phantom).toEqual([]);
});

test("pendingDeclarations lists only members that are still registered and still undeclared", () => {
  const stale = Object.entries(pendingDeclarations)
    .flatMap(([name, pr]) => {
      if (!registered.has(name)) return [`${name} (${pr}) is no longer registered in ${classesFile}`];
      if (declared.has(name)) return [`${name} (${pr}) is declared in ${dtsFile} now; delete its entry`];
      return [];
    })
    .sort();
  expect(stale).toEqual([]);
});
