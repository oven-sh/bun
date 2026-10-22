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

namespace Tools {
  export declare const scale: number;
  export declare let title: string;
  export declare function grow(n: number): number;
  export declare class Gear {
    teeth: number;
    constructor(teeth: number);
    turn(): number;
  }
  export declare namespace Inner {
    const depth: number;
  }
  export const real: number = 2;
  export function scaled(n: number): number {
    return n * scale;
  }
  export function grown(n: number): number {
    return grow(n) + 1;
  }
  export function heading(): string {
    return title + "!";
  }
  export function rename(text: string): void {
    title = text;
  }
}

function scaleOf(): number {
  return Tools.scale;
}

show("the number from outside", () => [Tools.scale, typeof Tools.scale, scaleOf()]);
show("the number plus one", () => [Tools.scale + 1, scaleOf() + 1]);
show("the number from inside", () => Tools.scaled(3));
show("the text from outside", () => Tools.title);
show("the length of the text", () => Tools.title.length);
show("the text from inside", () => Tools.heading());
show("the function from outside", () => typeof Tools.grow);
show("the function called from outside", () => Tools.grow(1));
show("the function called from inside", () => Tools.grown(1));
show("the class", () => typeof Tools.Gear);
show("the class constructed", () => new Tools.Gear(3));
show("instanceof the class", () => ({}) instanceof Tools.Gear);
show("the inner namespace", () => typeof Tools.Inner);
show("a member of the inner namespace", () => Tools.Inner.depth);
show("the real one", () => Tools.real);
show("keys", () => Object.keys(Tools));
show("in", () => ["scale" in Tools, "real" in Tools]);

Tools.title = "stored";
show("after a store", () => [Tools.title, Tools.heading(), Object.keys(Tools)]);

show("a store from inside", () => {
  Tools.rename("inside");
  return [Tools.title, Tools.heading()];
});

const writable: { scale: number } = Tools;
writable.scale = 4;
show("after the constant is stored to through a view", () => [Tools.scale, scaleOf(), Tools.scaled(3), Object.keys(Tools)]);
