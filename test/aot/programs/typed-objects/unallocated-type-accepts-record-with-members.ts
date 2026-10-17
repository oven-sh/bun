interface Inner {
  count: number;
  tags: string[];
}
interface Outer {
  id: number;
  name: string;
  inner: Inner;
}
const kept: object[] = [];
function merge<T extends { inner: object }, U extends { inner: object }>(one: T, other: U): T & U {
  const inner = { ...one.inner, ...other.inner };
  kept.push(inner);
  const merged = { ...one, ...other, inner };
  return merged as T & U;
}
function row(name: string, run: () => unknown): void {
  try {
    console.log(name + ": " + String(run()));
  } catch (error) {
    console.log(name + ": " + (error instanceof Error ? error.name : String(error)));
  }
}

const outer: Outer = { id: 1, name: "x", inner: { count: 10, tags: ["t"] } };
row("every member is there", () => {
  const inner = merge(outer, { inner: { extra: 1 } }).inner;
  const isTheSameObject = (inner as object) === kept[kept.length - 1];
  inner.count = 100;
  return isTheSameObject + " " + (kept[kept.length - 1] as Inner).count + " " + inner.count + ":" + inner.tags.length + ":" + inner.extra;
});
row("a member is missing", () => {
  const inner = merge(outer, { inner: {} as { extra: number } }).inner;
  return inner.count + ":" + inner.extra;
});
