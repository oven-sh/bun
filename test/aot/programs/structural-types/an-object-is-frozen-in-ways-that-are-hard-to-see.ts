interface Point {
  x: number;
  y: number;
}

class Pair {
  x = 1;
  y = 2;
  shift(): number {
    return ++this.x;
  }
}

function setX(p: Point): string {
  try {
    p.x = 50;
    return "stored " + p.x;
  } catch (error) {
    return "threw " + (error instanceof Error ? error.constructor.name : typeof error) + " " + p.x;
  }
}

function shift(p: Pair): string {
  try {
    return "shifted " + p.shift();
  } catch (error) {
    return "threw " + (error instanceof Error ? error.constructor.name : typeof error) + " " + p.x;
  }
}

function apply(action: (target: object) => unknown, target: object): void {
  action(target);
}

function deepFreeze(value: unknown): void {
  if (typeof value !== "object" || value === null) return;
  for (const inner of Object.values(value)) deepFreeze(inner);
  Object.freeze(value);
}

const renamed = Object.freeze;
const { freeze: taken } = Object;
const bound = Object.freeze.bind(Object);
const inAList = [Object.freeze];
const inARecord: Record<string, (target: object) => unknown> = { go: Object.freeze };
const made = new Function("target", "Object.freeze(target);");
const evaluated: (target: object) => void = (0, eval)("(function (target) { Object.freeze(target); })");
const key: string = ["g", "o"].join("");

const freezers: [string, (target: object) => void][] = [
  ["not at all", () => {}],
  ["directly", target => { Object.freeze(target); }],
  ["under another name", target => { renamed(target); }],
  ["taken out by a pattern", target => { taken(target); }],
  ["bound", target => { bound(target); }],
  ["call", target => { Object.freeze.call(Object, target); }],
  ["apply", target => { Object.freeze.apply(Object, [target]); }],
  ["Reflect.apply", target => { Reflect.apply(Object.freeze, Object, [target]); }],
  ["handed to forEach", target => { [target].forEach(Object.freeze); }],
  ["handed to map", target => { [target].map(renamed); }],
  ["handed to a function of ours", target => { apply(Object.freeze, target); }],
  ["out of a list", target => { inAList[0](target); }],
  ["out of a record by a computed name", target => { inARecord[key](target); }],
  ["from inside a wrapper object", target => { deepFreeze({ wrapped: [target] }); }],
  ["by code made at run time", target => { made(target); }],
  ["by evaluated code", target => { evaluated(target); }],
  ["in a promise reaction", () => {}],
  ["piece by piece", target => {
    Object.preventExtensions(target);
    for (const name of Object.keys(target)) Object.defineProperty(target, name, { writable: false, configurable: false });
  }],
  ["through a proxy", target => { Object.freeze(new Proxy(target, {})); }],
];

for (let i = 0; i < 2000; i++) {
  setX({ x: 1, y: 2 });
  shift(new Pair());
}

for (const [label, freeze] of freezers) {
  const literal: Point = { x: 1, y: 2 };
  const instance = new Pair();
  if (label === "in a promise reaction") {
    await Promise.resolve(literal).then(Object.freeze);
    await Promise.all([instance].map(async target => Object.freeze(target)));
  }
  freeze(literal);
  freeze(instance);
  console.log(label + ": literal " + setX(literal) + ", instance " + setX(instance) + ", its method " + shift(instance) + ", frozen " + Object.isFrozen(literal) + " " + Object.isFrozen(instance));
}

console.log("untouched afterwards: " + setX({ x: 1, y: 2 }) + ", " + shift(new Pair()));

export {};
