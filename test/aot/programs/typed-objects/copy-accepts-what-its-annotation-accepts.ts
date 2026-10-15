// `{ ...source, name: value }` under a written type, where the object that is copied was created as a narrower type than the one the copy is written as: the copy takes whatever its own written type takes.
const row = (name: string, f: () => unknown) => { let r: unknown; try { r = JSON.stringify(f()); } catch (e) { r = "THROWS " + (e as Error).message.split(" (bun")[0]; } console.log(name + ": " + r); };

type Failures = { last: number | null; count: number; name: string };
type Fresh = { last: null; count: number; name: string };
type FreshAndMore = { last: null; count: number; name: string; extra: boolean };
type Counts = { last: number; count: number };

const fresh: Fresh = { last: null, count: 0, name: "fresh" };
const freshAndMore: FreshAndMore = { last: null, count: 0, name: "more", extra: true };
const wide: Failures = { last: null, count: 0, name: "wide" };
const constant = { last: null, count: 0, name: "constant" } as const;

function stamp(failures: Failures, now: number): Failures {
  if (failures.last === null) return { ...failures, last: now };
  return failures;
}
function merge(failures: Failures, counts: Counts): Failures {
  if (failures.last === null) return { ...failures, ...counts };
  return failures;
}
function stampInsideTry(failures: Failures, now: number): Failures {
  try {
    return { ...failures, last: now };
  } catch {
    return failures;
  }
}
function stampAndCount(failures: Failures, now: number): Failures {
  return { ...failures, last: now, count: failures.count + 1 };
}
function stampWithWorkBetween(failures: Failures, now: number): Failures {
  return { ...failures, name: failures.name.toUpperCase(), last: Math.max(now, failures.count) };
}
function stampIf(failures: Failures, now: number): Failures {
  return { ...failures, ...(now > 0 ? { last: now } : {}) };
}
function stampAnd(failures: Failures, now: number): Failures {
  return { ...failures, ...(now > 0 && { last: now }) };
}
function clear(failures: Failures): Failures {
  return { ...failures, last: null };
}

const sources: [string, Failures][] = [["a narrower written type", fresh], ["a narrower type with one member more", freshAndMore], ["the written type itself", wide], ["an `as const` literal", constant]];
for (const [name, source] of sources) {
  row(name + ": one member written behind the spread", () => stamp(source, 7));
  row(name + ": a second spread of a typed object", () => merge(source, { last: 8, count: 1 }));
  row(name + ": inside try", () => stampInsideTry(source, 10));
  row(name + ": two members", () => stampAndCount(source, 11));
  row(name + ": with calls between the members", () => stampWithWorkBetween(source, 12));
  row(name + ": a conditional literal spread", () => [stampIf(source, 13), stampIf(source, 0)]);
  row(name + ": a literal spread behind &&", () => [stampAnd(source, 14), stampAnd(source, 0)]);
  row(name + ": a value the narrower type takes too", () => clear(source));
  row(name + ": the keys of the copy", () => Object.keys(stamp(source, 15)));
  row(name + ": the copy is stored to again", () => { const copy = stamp(source, 16); copy.last = null; copy.count = 3; const again = stamp(copy, 17); return [copy, again]; });
  row(name + ": the source is left as it was", () => source);
}
row("the member more is read from the copy", () => { const copy = stamp(freshAndMore, 18); return ["extra" in copy, (copy as FreshAndMore).extra]; });

let sum = 0;
for (let i = 0; i < 20000; i++) {
  const source = i % 3 === 0 ? fresh : i % 3 === 1 ? wide : freshAndMore;
  sum += stamp(source, i).last! + merge(source, { last: i, count: 1 }).count + stampAndCount(source, i).count;
}
row("many times, the types taking turns", () => sum);

type Inner = { a: number };
type Outer = { inner: Inner | undefined; label: string | number; on: boolean; list: number[] | null };
type Bare = { inner: undefined; label: string; on: false; list: null };
const bare: Bare = { inner: undefined, label: "x", on: false, list: null };
const fill = (outer: Outer): Outer => ({ ...outer, inner: { a: 1 }, label: 5, on: true, list: [1, 2] });
row("undefined to an object, a string to a number, false to true, null to an array", () => [fill(bare), bare]);
row("what was filled is read", () => { const filled = fill(bare); return [filled.inner!.a + 1, typeof filled.label, filled.on === true, filled.list!.length]; });

type Optional = { last?: number; count: number };
type Without = { count: number };
type NeverSet = { last?: undefined; count: number };
const without: Without = { count: 0 };
const neverSet: NeverSet = { count: 1 };
const setLast = (given: Optional, now: number): Optional => ({ ...given, last: now });
row("an optional member the source has no room for", () => [setLast(without, 19), setLast(neverSet, 20), without, neverSet]);

type State = { failures: Failures; name: string };
const nested = (state: State, counts: Counts): State => (state.failures.last === null ? { ...state, failures: { ...state.failures, ...counts } } : state);

let held: Failures = fresh;
const update = (f: (previous: Failures) => Failures) => { held = f(held); };
update(previous => (previous.last === null ? { ...previous, last: 22 } : previous));
row("through an updater", () => held);
update(previous => ({ ...previous, last: null }));
row("through an updater, back to null", () => held);

type Flagged = { readonly on: boolean; readonly text: string | undefined };
type Off = { readonly on: false; readonly text: undefined };
const off: Off = { on: false, text: undefined };
const turnOn = (flagged: Flagged): Flagged => ({ ...flagged, on: true, text: "t" });
row("readonly members", () => [turnOn(off), off]);

type Tally = { readonly tries: number } & { readonly saved: number | null; readonly waited: boolean };
const noTally: Tally = Object.freeze({ tries: 0, saved: null, waited: false });
const save = (tally: Tally, more: { tries: number } | null): Tally => (tally.saved !== null ? tally : { ...tally, ...more, saved: Object.values(more ?? {}).reduce((sum, n) => sum + n, 0) });
row("a literal created inside Object.freeze()", () => [save(noTally, { tries: 2 }), save(noTally, null), Object.isFrozen(save(noTally, null)), noTally]);
