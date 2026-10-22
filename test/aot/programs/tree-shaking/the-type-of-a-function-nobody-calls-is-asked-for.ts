// These functions are never called, so their bodies may go. Their types stay in use: each has no return type written down, and code that runs is typed by ReturnType, Parameters, typeof and Awaited of them.
function shape() {
  return { width: 2, height: 3, label: "box" };
}
function pair(first: number, second: string) {
  return [first, second] as const;
}
async function later() {
  return { done: true, count: 1 };
}
function* steps() {
  yield 1;
  yield 2;
}
const arrow = (value: number) => ({ doubled: value * 2 });
function nested() {
  return shape().width > 1 ? pair(1, "a") : undefined;
}

type Shape = ReturnType<typeof shape>;
const box: Shape = { width: 4, height: 5, label: "crate" };
const args: Parameters<typeof pair> = [1, "one"];
const result: Awaited<ReturnType<typeof later>> = { done: false, count: 7 };
const step: ReturnType<typeof steps> extends Generator<infer T> ? T : never = 2;
const doubled: ReturnType<typeof arrow> = { doubled: 8 };
const maybe: ReturnType<typeof nested> = [1, "a"];
let same: typeof shape | undefined;

console.log(box.width * box.height, box.label.toUpperCase());
console.log(args[0] + 1, args[1].length, result.count + 1, !result.done, step + 1, doubled.doubled / 2, maybe?.[1], same);
