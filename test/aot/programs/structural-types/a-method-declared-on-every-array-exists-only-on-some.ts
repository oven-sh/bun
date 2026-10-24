function text(value: unknown): string {
  if (typeof value === "number") return "number " + (Object.is(value, -0) ? "-0" : String(value));
  if (typeof value === "string") return "string " + JSON.stringify(value);
  if (typeof value === "function") return "function " + value.name;
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? text(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "object " + JSON.stringify(value);
  return typeof value + " " + String(value);
}

function show(label: string, run: () => unknown): void {
  try {
    console.log(label + ": " + text(run()));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

declare global {
  interface Array<T> {
    last(): T;
    mark: string;
  }
}

class Rich extends Array<number> {
  last(): number {
    return this[this.length - 1];
  }
  mark: string = "rich";
}

function withOwn(list: number[]): number[] {
  return Object.assign(list, {
    last(this: number[]): number {
      return this[this.length - 1];
    },
    mark: "own",
  });
}

function rich(...items: number[]): Rich {
  const list = new Rich();
  for (const item of items) list.push(item);
  return list;
}

function lastOf(list: number[]): number {
  return list.last();
}

function markOf(list: number[]): string {
  return list.mark;
}

function attempt(list: number[]): string {
  try {
    return String(lastOf(list));
  } catch (error) {
    return error instanceof TypeError ? "TypeError" : "another error";
  }
}

show("the first call gets a plain list", () => attempt([1, 2]));
let sum = 0;
for (let i = 0; i < 2000; i++) sum += lastOf(i % 2 === 0 ? rich(i, 1) : withOwn([i, 2])) + markOf(rich(1)).length;
show("2000 that have it", () => sum);
show("a plain list", () => attempt([1, 2]));
show("its mark", () => markOf([1, 2]));
show("the length of its mark", () => markOf([1, 2]).length);
show("one of the subclass", () => [attempt(rich(1, 5)), markOf(rich(1))]);
show("one with its own", () => [attempt(withOwn([1, 6])), markOf(withOwn([1]))]);
show("five in a row", () => [rich(1), [2], withOwn([3]), [4], rich(5)].map(attempt));
show("a copy of the subclass keeps it", () => attempt(rich(1, 2, 3).slice(1)));
show("a copy of the one with its own loses it", () => attempt(withOwn([1, 2, 3]).slice(1)));
show("a spread of the subclass loses it", () => attempt([...rich(1, 2, 3)]));
show("keys of each", () => [Object.keys(rich(7)), Object.keys(withOwn([7])), Object.keys([7])]);
show("JSON of each", () => [JSON.stringify(rich(7)), JSON.stringify(withOwn([7])), JSON.stringify([7])]);

export {};
