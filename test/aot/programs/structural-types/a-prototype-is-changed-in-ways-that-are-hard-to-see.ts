class Cat {
  name = "cat";
  speak(): string {
    return "meow";
  }
}

class Robot {
  name = "robot";
  speak(): string {
    return "beep";
  }
}

function facts(c: Cat): string {
  return c.speak() + " " + (c instanceof Cat) + " " + (c instanceof Robot) + " " + c.constructor.name + " " + c.name;
}

function apply(action: (target: object, proto: object | null) => unknown, target: object): void {
  action(target, Robot.prototype);
}

const renamed = Object.setPrototypeOf;
const { setPrototypeOf: taken } = Reflect;
const bound = Object.setPrototypeOf.bind(Object);
const made = new Function("target", "proto", "Object.setPrototypeOf(target, proto);");
const madeWithProto = new Function("target", "proto", "target.__proto__ = proto;");
const evaluated: (target: object, proto: object) => void = (0, eval)("(function (target, proto) { Reflect.setPrototypeOf(target, proto); })");
const setter = Object.getOwnPropertyDescriptor(Object.prototype, "__proto__")?.set;
const table: Record<string, (target: object, proto: object | null) => unknown> = { go: Object.setPrototypeOf };
const key: string = ["g", "o"].join("");

const changers: [string, (target: object) => void][] = [
  ["not at all", () => {}],
  ["directly", target => { Object.setPrototypeOf(target, Robot.prototype); }],
  ["Reflect", target => { Reflect.setPrototypeOf(target, Robot.prototype); }],
  ["under another name", target => { renamed(target, Robot.prototype); }],
  ["taken out by a pattern", target => { taken(target, Robot.prototype); }],
  ["bound", target => { bound(target, Robot.prototype); }],
  ["call", target => { Object.setPrototypeOf.call(Object, target, Robot.prototype); }],
  ["apply", target => { Object.setPrototypeOf.apply(Object, [target, Robot.prototype]); }],
  ["Reflect.apply", target => { Reflect.apply(Object.setPrototypeOf, Object, [target, Robot.prototype]); }],
  ["handed to a function of ours", target => { apply(Object.setPrototypeOf, target); }],
  ["out of a record by a computed name", target => { table[key](target, Robot.prototype); }],
  ["the setter of __proto__", target => { setter?.call(target, Robot.prototype); }],
  ["by code made at run time", target => { made(target, Robot.prototype); }],
  ["by a store to __proto__ in code made at run time", target => { madeWithProto(target, Robot.prototype); }],
  ["by evaluated code", target => { evaluated(target, Robot.prototype); }],
  ["through a proxy", target => { Object.setPrototypeOf(new Proxy(target, {}), Robot.prototype); }],
  ["out of a list", target => { for (const each of [target]) Object.setPrototypeOf(each, Robot.prototype); }],
  ["to an object that inherits from the class", target => { Object.setPrototypeOf(target, Object.create(Cat.prototype, { speak: { value: () => "purr" } })); }],
  ["to nothing", target => { Object.setPrototypeOf(target, null); }],
];

let warm = 0;
for (let i = 0; i < 2000; i++) warm += facts(new Cat()).length;
console.log("2000 honest: " + warm);

for (const [label, change] of changers) {
  const cat = new Cat();
  change(cat);
  try {
    console.log(label + ": " + facts(cat));
  } catch (error) {
    console.log(label + ": threw " + (error instanceof Error ? error.constructor.name : typeof error) + " " + (cat instanceof Cat) + " " + cat.name);
  }
}

console.log("an untouched cat: " + facts(new Cat()));

const litter = [new Cat(), new Cat(), new Cat()];
made(litter[1], Robot.prototype);
console.log("one of three: " + litter.map(c => c.speak()).join() + " " + litter.map(c => c instanceof Cat).join());

export {};
