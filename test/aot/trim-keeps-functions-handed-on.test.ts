import { expect } from "bun:test";
import { isASAN, isDebug } from "harness";
import { builtinEntries } from "../bundler/compile-trim-features";
import { inShare, takesWhatIsFixed } from "./run-programs";
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

async function mapInParallel<Item, Result>(
  items: Item[],
  width: number,
  run: (item: Item) => Promise<Result>,
): Promise<Result[]> {
  const results: Result[] = [];
  let next = 0;
  const work = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await run(items[index]);
    }
  };
  await Promise.all(Array.from({ length: width }, work));
  return results;
}

const reportOn = async (members: Callable[], [, call]: Way) =>
  (await of(members.map(({ holder, name }) => `try { ${call(holder, name)} } catch {}`).join("\n"))).lines;

// Not every feature has a line in the report, so a function of the table is asked for those that a call on its holder keeps.
function expectWaysToKeepFeatures(title: string, members: Callable[], ways: Way[], needsAllFeatures = false) {
  test(
    title,
    async () => {
      const [onHolder, ...reports] = await mapInParallel([calledOnItsHolder, ...ways], 4, way =>
        reportOn(members, way),
      );
      const needed = members.flatMap(({ features }) =>
        features
          .filter(
            ({ feature, isConditional }) => !isConditional && (needsAllFeatures || retainsFeature(onHolder, feature)),
          )
          .map(({ feature }) => feature),
      );
      expect(needed.length).toBeGreaterThan(0);
      expect(
        ways.flatMap(([way], index) =>
          needed.filter(feature => !retainsFeature(reports[index], feature)).map(feature => `${feature} after ${way}`),
        ),
      ).toEqual([]);
    },
    240_000,
  );
}

if (takesWhatIsFixed) {
  for (const member of membersWithoutEntry)
    expectWaysToKeepFeatures(
      `${member.path}, called in every way`,
      [member],
      [calledOnItsHolder, ...waysToHandOn],
      true,
    );

  const firstOfEachFeature = [
    ...new Map(callables.toReversed().map(callable => [callable.features[0].feature, callable])).values(),
  ].toReversed();
  for (const [index, members] of packWithoutSharedFeatures(firstOfEachFeature, 12).entries()) {
    const ways = [0, 1].map(step => waysToHandOn[(index * 2 + step) % waysToHandOn.length]);
    expectWaysToKeepFeatures(
      `${members[0].path} to ${members.at(-1)!.path}, after ${ways.map(([way]) => way).join(" and ")}`,
      members,
      ways,
    );
  }
}

for (const callable of callables) {
  const ways = waysToHandOn.filter(([way]) =>
    inShare(`${callable.path} after ${way}`, isDebug || isASAN ? 4_000 : 400),
  );
  if (ways.length)
    expectWaysToKeepFeatures(`${callable.path}, after ${ways.map(([way]) => way).join(" and ")}`, [callable], ways);
}
