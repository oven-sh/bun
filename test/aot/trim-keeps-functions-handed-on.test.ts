import { expect } from "bun:test";
import { builtinEntries } from "../bundler/compile-trim-features";
import { retainsFeature } from "./runtime-use-expectations";
import { of } from "./runtime-use-harness";
import { test } from "./supported";
import { calledOnItsHolder, waysToHandOn } from "./ways-to-hand-a-function-on";

type Feature = { feature: string; isConditional: boolean };
type Callable = { path: string; holder: string; name: string; features: Feature[] };
type Way = (typeof waysToHandOn)[number];

const isIdentifier = (text: string) => /^[A-Za-z_$][\w$]*$/.test(text);

function describeCallable(path: string, features: Feature[]): Callable | undefined {
  const holders = path.split(".");
  const name = holders.pop()!;
  const start = holders[0]?.includes(":")
    ? `process.getBuiltinModule(${JSON.stringify(holders.shift())})`
    : "(globalThis as any)";
  return [...holders, name].every(isIdentifier)
    ? { path, holder: [start, ...holders].join("."), name, features }
    : undefined;
}

const callables = builtinEntries
  .filter(
    ({ kind, hasHiddenRoot, uses }) =>
      !hasHiddenRoot && uses.some(use => !use.isConditional) && (kind === "Function" || kind === "Method"),
  )
  .map(({ path, uses }) => describeCallable(path, uses))
  .filter(callable => callable !== undefined);

// Members of functions that the table of built-ins has no entry for.
const membersWithoutEntry = [
  ["Bun.cron.parse", "Cron"],
  ["Bun.cron.remove", "Cron"],
  ["Bun.inspect.table", "ConsoleTable"],
].map(([path, feature]) => describeCallable(path, [{ feature, isConditional: false }])!);

// No two functions of a program share a feature, so none keeps what another one needs.
function packWithoutSharedFeatures(all: Callable[], most: number): Callable[][] {
  const packs: { members: Callable[]; features: Set<string> }[] = [];
  for (const callable of all) {
    let pack = packs.find(
      ({ members, features }) =>
        members.length < most && !callable.features.some(({ feature }) => features.has(feature)),
    );
    if (!pack) packs.push((pack = { members: [], features: new Set() }));
    pack.members.push(callable);
    for (const { feature } of callable.features) pack.features.add(feature);
  }
  return packs.map(({ members }) => members);
}

const reportOn = async (calls: [member: Callable, way: Way][]) =>
  (await of(calls.map(([{ holder, name }, [, call]]) => `try { ${call(holder, name)} } catch {}`).join("\n"))).lines;

// Each function of the program is handed on in a way of its own.
// Not every feature has a line in the report, so a function of the table is asked for those that a call on its holder keeps.
function expectWaysToKeepFeatures(title: string, calls: [member: Callable, way: Way][], needsAllFeatures = false) {
  test.concurrent(
    title,
    async () => {
      const [onHolder, handedOn] = await Promise.all([
        reportOn(calls.map(([member]) => [member, calledOnItsHolder])),
        reportOn(calls),
      ]);
      const needed = calls.flatMap(([{ path, features }, [way]]) =>
        features
          .filter(
            ({ feature, isConditional }) => !isConditional && (needsAllFeatures || retainsFeature(onHolder, feature)),
          )
          .map(({ feature }) => ({ feature, lost: `${feature}: ${path} after ${way}` })),
      );
      expect(needed.length).toBeGreaterThanOrEqual(calls.length / 2);
      expect(needed.filter(({ feature }) => !retainsFeature(handedOn, feature)).map(({ lost }) => lost)).toEqual([]);
    },
    240_000,
  );
}

const wayNamed = (name: string) => waysToHandOn.find(([way]) => way === name)!;
const [parse, remove, table] = membersWithoutEntry;
for (const [first, second] of [
  ["a comma expression", "destructuring"],
  ["destructuring", "bind"],
  ["bind", "Reflect.get"],
  ["Reflect.get", "a parameter"],
  ["a parameter", "a comma expression"],
])
  expectWaysToKeepFeatures(
    `${parse.path} after ${first}, ${table.path} after ${second}`,
    [
      [parse, wayNamed(first)],
      [table, wayNamed(second)],
    ],
    true,
  );
expectWaysToKeepFeatures(`${remove.path} after a constant`, [[remove, wayNamed("a constant")]], true);

const firstOfEachFeature = [
  ...new Map(callables.toReversed().map(callable => [callable.features[0].feature, callable])).values(),
].toReversed();
// The functions of the language bring less of Bun's own modules along than those of the host, and a way does not ask whose function it hands on.
const ofTheLanguage = firstOfEachFeature.filter(({ path }) =>
  /^[A-Z]\w+\.prototype\.|^(Math|JSON|Object|Reflect|Atomics)\./.test(path),
);
const [members] = packWithoutSharedFeatures([...ofTheLanguage, ...firstOfEachFeature], waysToHandOn.length);
expectWaysToKeepFeatures(
  `${members[0].path} to ${members.at(-1)!.path}, each in another way`,
  members.map((member, index) => [member, waysToHandOn[index]]),
);
