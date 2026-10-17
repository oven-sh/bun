// One object made by generic code is read through several instantiations of the same generic record.
// Whatever order the reads come in, a value that fits every one of those types is accepted by all of them.
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
type NearCause = "send" | "poll";
type NearResult = "status" | "not_found";
type NearServed = Served<NearCause, NearResult>;
type One = Served<"poll", "status">;
type Wide = Served<string, string>;

function nested<C, R>(cause: C, result: R): { served: Served<C, R>; n: number } {
  return { served: { cause, result, number: 2 }, n: 0 };
}
const useOne = (s: One): string => s.cause + s.result + s.number;
const useNear = (s: NearServed): string => s.cause.toUpperCase() + s.result.length + s.number;
const useWide = (s: Wide): string => s.cause + "/" + s.result + "/" + s.number;

row("narrowest first", () => {
  const u = nested<"poll", "status">("poll", "status");
  const one: { served: One } = u, near: { served: NearServed } = u, wide: { served: Wide } = u;
  return [useOne(one.served), useNear(near.served), useWide(wide.served)];
});
row("widest first", () => {
  const u = nested<"poll", "status">("poll", "status");
  const one: { served: One } = u, near: { served: NearServed } = u, wide: { served: Wide } = u;
  return [useWide(wide.served), useNear(near.served), useOne(one.served)];
});
row("middle, then narrowest", () => {
  const u = nested<"poll", "status">("poll", "status");
  const one: { served: One } = u, near: { served: NearServed } = u;
  return [useNear(near.served), useOne(one.served)];
});
row("middle, narrowest, middle, widest", () => {
  const u = nested<"poll", "status">("poll", "status");
  const one: { served: One } = u, near: { served: NearServed } = u, wide: { served: Wide } = u;
  return [useNear(near.served), useOne(one.served), useNear(near.served), useWide(wide.served)];
});
row("it is the same object every time", () => {
  const u = nested<"poll", "status">("poll", "status");
  const one: { served: One } = u, near: { served: NearServed } = u, wide: { served: Wide } = u;
  const first = wide.served, second = near.served, third = one.served;
  return [first === second, second === third, u.served === third, Object.keys(third).join()];
});
row("a store through the middle type is seen through the others", () => {
  const u = nested<"poll", "status">("poll", "status");
  const one: { served: One } = u, near: { served: NearServed } = u, wide: { served: Wide } = u;
  near.served.number = 5;
  one.served.number += 1;
  return [useWide(wide.served), useNear(near.served), useOne(one.served)];
});
row("in a loop", () => {
  const out: string[] = [];
  for (let i = 0; i < 3; i++) {
    const u = nested<"poll", "status">("poll", "status");
    const one: { served: One } = u, near: { served: NearServed } = u, wide: { served: Wide } = u;
    out.push(i % 2 ? useNear(near.served) + useOne(one.served) : useWide(wide.served) + useNear(near.served) + useOne(one.served));
  }
  return out;
});
row("another value stays the middle type", () => {
  const u = nested<NearCause, NearResult>("send", "not_found");
  const near: { served: NearServed } = u, wide: { served: Wide } = u;
  return [useWide(wide.served), useNear(near.served), useWide(wide.served)];
});
