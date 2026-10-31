import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import bunClasses from "../../../src/runtime/api/BunObject.classes.ts";

// `interface Subprocess` in packages/bun-types/bun.d.ts is a hand-written mirror
// of the Subprocess `proto` table in src/runtime/api/BunObject.classes.ts, which
// is what the class codegen installs on Subprocess.prototype. Nothing else
// compares the two: `writable` was registered next to `readable` in 2022 and
// stayed undeclared until 2026, so `proc.writable` worked at runtime and failed
// to type-check. Same check as redis-client-types.test.ts, reading an interface
// body instead of a class body.

// Registered members that are not declared yet, each with the open PR that
// declares it. Delete the entry when that PR lands: the lint fails while a name
// listed here is declared (or is no longer registered).
const pendingDeclarations: Record<string, string> = {
  connected: "#38677",
};

// Registered members the interface declares through its `extends` clause rather
// than in its body, keyed to the interface that declares them.
const declaredByExtends: Record<string, string> = {
  "@@asyncDispose": "AsyncDisposable",
};

const classesFile = "src/runtime/api/BunObject.classes.ts";
const dtsFile = "packages/bun-types/bun.d.ts";
const root = path.resolve(import.meta.dir, "..", "..", "..");

const definition = bunClasses.find(c => c.name === "Subprocess");
if (definition === undefined) throw new Error(`${classesFile} no longer defines Subprocess`);
// An interface body can only mirror prototype members. A constructor or statics
// would need a value declaration this lint does not read.
if (!definition.noConstructor || Object.keys(definition.klass).length !== 0) {
  throw new Error(
    `Subprocess in ${classesFile} has a constructor or statics, which \`interface Subprocess\` cannot declare`,
  );
}

// Every member the codegen installs on the prototype. A well-known symbol stays
// in the table's `@@x` spelling; parseInterfaceBody maps `[Symbol.x]` onto it.
const registered = new Set<string>();
for (const [name, field] of Object.entries(definition.proto)) {
  // Installed under a private name or a Symbol.for() symbol, or (internal) not
  // installed at all; none of these has a declaration to mirror.
  if ("internal" in field || "privateSymbol" in field || "publicSymbol" in field) continue;
  registered.add(name);
}

const { extended, declared, unrecognized } = parseInterfaceBody(readFileSync(path.join(root, dtsFile), "utf8"));
for (const [name, base] of Object.entries(declaredByExtends)) {
  if (extended.includes(base)) declared.add(name);
}

function parseInterfaceBody(dts: string): { extended: string[]; declared: Set<string>; unrecognized: string[] } {
  // The header spans several lines because of the type parameter list.
  const open = /^  interface Subprocess<\n(?: {4}.*\n)*  >(?: extends (.+))? \{$/m.exec(dts);
  if (open === null) throw new Error(`${dtsFile} no longer declares \`interface Subprocess<...> {\``);
  const extended = open[1] === undefined ? [] : open[1].split(",").map(base => base.trim());
  const bodyStart = open.index + open[0].length;
  const bodyEnd = dts.indexOf("\n  }\n", bodyStart);
  if (bodyEnd === -1) throw new Error(`${dtsFile}: unterminated interface Subprocess body`);

  const body = dts
    .slice(bodyStart, bodyEnd)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");

  const declared = new Set<string>();
  const unrecognized: string[] = [];
  // Members start at the body's four-space indent. The only other lines at that
  // indent are the `): ...;` closers of multi-line signatures, which start with
  // punctuation, so everything else at that indent is a member and has to
  // parse: a declaration shape this does not know is reported rather than
  // skipped.
  const member = /^(?:readonly )?(?:\[Symbol\.(\w+)\]|([A-Za-z_$][\w$]*))\s*\??\s*[(:<]/;
  for (const [line] of body.matchAll(/^    [^\s)\]}>].*$/gm)) {
    const m = member.exec(line.slice(4));
    if (m === null) {
      unrecognized.push(line.trim());
      continue;
    }
    declared.add(m[1] !== undefined ? `@@${m[1]}` : m[2]!);
  }
  return { extended, declared, unrecognized };
}

test(`every member of interface Subprocess in ${dtsFile} has a shape this lint can read`, () => {
  expect(unrecognized).toEqual([]);
});

test(`${dtsFile} declares every Subprocess member ${classesFile} installs`, () => {
  const undeclared = [...registered]
    .filter(name => !declared.has(name) && !Object.hasOwn(pendingDeclarations, name))
    .sort();
  expect(undeclared).toEqual([]);
});

test(`${dtsFile} declares no Subprocess member ${classesFile} does not install`, () => {
  const phantom = [...declared].filter(name => !registered.has(name)).sort();
  expect(phantom).toEqual([]);
});

test("pendingDeclarations and declaredByExtends describe the current files", () => {
  const stale = [
    ...Object.entries(pendingDeclarations).flatMap(([name, pr]) => {
      if (!registered.has(name)) return [`${name} (${pr}) is no longer registered in ${classesFile}`];
      if (declared.has(name)) return [`${name} (${pr}) is declared in ${dtsFile} now; delete its entry`];
      return [];
    }),
    ...Object.entries(declaredByExtends).flatMap(([name, base]) =>
      extended.includes(base) ? [] : [`interface Subprocess no longer extends ${base}, which declared ${name}`],
    ),
  ].sort();
  expect(stale).toEqual([]);
});
