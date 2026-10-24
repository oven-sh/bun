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

interface Stack extends Array<number> {}
class Stack {
  id: number = 1;
}

function total(list: number[]): number {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

function totalByOf(list: number[]): number {
  let sum = 0;
  for (const n of list) sum += n;
  return sum;
}

function lengthOf(list: number[]): number {
  return list.length;
}

function firstOf(list: number[]): number {
  return list[0];
}

function pushTo(list: number[], n: number): number {
  return list.push(n);
}

function doubled(list: number[]): number[] {
  return list.map(n => n * 2);
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += total([i, 1]) + totalByOf([i]) + lengthOf([i]) + firstOf([i]) + pushTo([i], 1) + doubled([i])[0];
show("2000 honest rounds", () => warm);

const stack = new Stack();
show("length", () => stack.length);
show("length through a function", () => lengthOf(stack));
show("length plus one", () => lengthOf(stack) + 1);
show("first", () => firstOf(stack));
show("total by index", () => total(stack));
show("total by for of", () => totalByOf(stack));
show("push", () => pushTo(stack, 1));
show("map", () => doubled(stack));
show("typeof push", () => typeof stack.push);
show("Array.isArray", () => Array.isArray(stack));
show("instanceof Array", () => stack instanceof Array);
show("spread", () => [...stack]);
show("Array.from", () => Array.from(stack));
show("concat as an argument", () => [0].concat(stack).length);
show("toString", () => stack.toString());
show("keys", () => Object.keys(stack));
show("JSON", () => JSON.stringify(stack));

stack[0] = 7;
stack.length = 1;
show("after stores: keys", () => Object.keys(stack));
show("after stores: total by index", () => total(stack));
show("after stores: first and length", () => [firstOf(stack), lengthOf(stack)]);
show("after stores: Array.from", () => Array.from(stack));
show("after stores: total by for of", () => totalByOf(stack));
stack[5] = 9;
show("a store past the end leaves the length", () => [lengthOf(stack), Object.keys(stack)]);
show("honest again", () => [total([1, 2]), totalByOf([1, 2]), lengthOf([1]), pushTo([1], 2), doubled([4])]);
