// One object made by generic code is read through two instantiations of the same generic record, neither of which is narrower than the other.
// The value fits both, so both reads are accepted, in either order.
function row(name: string, f: () => unknown): void {
  let said: string;
  try {
    said = JSON.stringify(f());
  } catch (e) {
    said = "threw " + (e as Error).name;
  }
  console.log(name + ": " + said);
}

type Served<Cause, Result> = { cause: Cause; result: Result; number: number };
type ByCause = Served<"poll", string>;
type ByResult = Served<string, "status">;

function nested<C, R>(cause: C, result: R): { served: Served<C, R>; n: number } {
  return { served: { cause, result, number: 2 }, n: 0 };
}
const useCause = (s: ByCause): string => s.cause + ":" + s.result.length + s.number;
const useResult = (s: ByResult): string => s.cause.length + ":" + s.result + s.number;

row("by cause, then by result", () => {
  const u = nested<"poll", "status">("poll", "status");
  const a: { served: ByCause } = u, b: { served: ByResult } = u;
  return [useCause(a.served), useResult(b.served)];
});
row("by result, then by cause", () => {
  const u = nested<"poll", "status">("poll", "status");
  const a: { served: ByCause } = u, b: { served: ByResult } = u;
  return [useResult(b.served), useCause(a.served)];
});
row("back and forth on the same object", () => {
  const u = nested<"poll", "status">("poll", "status");
  const a: { served: ByCause } = u, b: { served: ByResult } = u;
  return [useCause(a.served), useResult(b.served), useCause(a.served), useResult(b.served), a.served === (b.served as unknown), Object.keys(u.served).join()];
});
row("a store through one is seen through the other", () => {
  const u = nested<"poll", "status">("poll", "status");
  const a: { served: ByCause } = u, b: { served: ByResult } = u;
  a.served.number = 7;
  b.served.number += 1;
  return [useCause(a.served), useResult(b.served), u.served.number];
});
row("in a loop", () => {
  const out: string[] = [];
  for (let i = 0; i < 4; i++) {
    const u = nested<"poll", "status">("poll", "status");
    const a: { served: ByCause } = u, b: { served: ByResult } = u;
    out.push(i % 2 ? useCause(a.served) + useResult(b.served) : useResult(b.served) + useCause(a.served));
  }
  return out;
});
row("only by cause", () => {
  const u = nested<"poll", string>("poll", "anything");
  const a: { served: ByCause } = u;
  return [useCause(a.served), useCause(a.served)];
});
