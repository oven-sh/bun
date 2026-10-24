function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "function") return "function " + value.name;
  if (typeof value === "object" && value !== null) return value.constructor.name + " " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function tally(n: number): number {
  tally.total += n;
  tally.calls++;
  return tally.total;
}
tally.total = 0;
tally.calls = 0;
tally.label = "tally";
tally.reset = function (): void {
  tally.total = 0;
};

const arrow = (n: number): number => n + arrow.offset;
arrow.offset = 10;

interface Tally {
  (n: number): number;
  total: number;
  calls: number;
  label: string;
  reset(): void;
}

function use(t: Tally, n: number): string {
  return t(n) + " " + t.total + " " + t.calls + " " + t.label;
}

show("call", () => tally(2));
show("total", () => tally.total);
show("as the interface", () => use(tally, 3));
show("reset", () => tally.reset());
show("total", () => tally.total);
show("calls", () => tally.calls);
show("keys", () => Object.keys(tally).join());
show("arrow", () => arrow(1));
arrow.offset = 0.5;
show("arrow after a store", () => arrow(1));
show("arrow keys", () => Object.keys(arrow).join());

let sum = 0;
for (let i = 0; i < 2000; i++) sum = tally(1);
show("2000 calls", () => sum);
show("calls", () => tally.calls);

const wide: { total: number | string } = tally;
wide.total = "text";
show("a string in total through a wider alias", () => tally.total);
show("call", () => tally(1));
show("typeof total", () => typeof tally.total);

const copy: Tally = Object.assign((n: number) => n, { total: 1, calls: 1, label: "copy", reset() {} });
show("another function for the same interface", () => use(copy, 7));
show("the first again", () => {
  tally.reset();
  return use(tally, 7);
});
