/// <reference path="./gadgets.d.ts" />
import { count, half, label, Lamp, ready, settings, sizes } from "gadgets";

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

function plusOne(n: number): number {
  return n + 1;
}

function lengthOf(s: string): number {
  return s.length;
}

function total(list: number[]): number {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

let warm = 0;
for (let i = 0; i < 2000; i++) warm += plusOne(i) + lengthOf("ab") + total([i, 1]);
show("2000 honest rounds", () => warm);

show("the number is text", () => [count, typeof count, count + 1, plusOne(count), count * 2]);
show("the text is a number", () => [label, typeof label, label + "!", lengthOf(label)]);
show("the text in capitals", () => label.toUpperCase());
show("the list is an array-like", () => [sizes.length, sizes[0], total(sizes), Array.isArray(sizes)]);
show("a method of the list", () => sizes.map(plusOne));
show("the list iterated", () => [...sizes]);
show("the boolean is text", () => [ready, ready ? "yes" : "no", ready === true, ready === false, !ready]);
show("the function answers text", () => [half(4), typeof half(4), plusOne(half(4))]);
show("a member is null and another is not there", () => [settings.depth, settings.depth + 1, settings.width, settings.width + 1]);
show("the class makes another member", () => {
  const lamp = new Lamp(60);
  return [lamp.watts, plusOne(lamp.watts), Object.keys(lamp)];
});
show("its method answers text", () => [new Lamp(60).brighter(), plusOne(new Lamp(60).brighter())]);
show("extended", () => {
  class Bright extends Lamp {
    extra: number = 1;
    both(): number {
      return this.watts + this.extra;
    }
  }
  const bright = new Bright(40);
  return [bright.both(), bright.brighter(), Object.keys(bright)];
});
show("honest again", () => [plusOne(1), lengthOf("ab"), total([1, 2])]);
