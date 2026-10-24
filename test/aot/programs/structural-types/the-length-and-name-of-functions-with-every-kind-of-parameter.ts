function none(): void {}
function one(a: number): void {}
function optional(a: number, b?: number): void {}
function onlyOptional(a?: number, b?: number): void {}
function defaulted(a: number, b: number = 1): void {}
function defaultFirst(a: number = 1, b: number): void {}
function defaultInTheMiddle(a: number, b: number = 1, c: number): void {}
function rest(...all: number[]): void {}
function oneAndRest(a: number, ...others: number[]): void {}
function pattern({ a }: { a: number }, [b]: number[]): void {}
function patternWithDefault({ a }: { a: number } = { a: 1 }, b: number): void {}
function withThis(this: { x: number }, a: number): void {}
function overloaded(a: number): void;
function overloaded(a: number, b: number, c: number): void;
function overloaded(a: number, b?: number, c?: number, d?: number): void {}
function* generator(a: number, b: number): Generator<number, void, void> {}
async function asynchronous(a: number, b: number = 1): Promise<void> {}
async function* asyncGenerator(a: number): AsyncGenerator<number, void, void> {}

class Plain {}
class WithConstructor {
  constructor(a: number, b: number, c?: number) {}
  method(a: number, b: number = 1): void {}
  static fixed(a: number): void {}
  get value(): number {
    return 1;
  }
  set value(v: number) {}
  ["computed" + 1](a: number): void {}
  #hidden(a: number): void {}
  hiddenShape(): string {
    return this.#hidden.name + "/" + this.#hidden.length;
  }
  field = (a: number, b: number): void => {};
}
class Derived extends WithConstructor {}
class DerivedWithFields extends WithConstructor {
  extra = 1;
}

const arrow = (a: number, b: number): void => {};
const anonymous = function (a: number): void {};
const named = function inner(a: number): void {};
const classExpression = class {};
const namedClassExpression = class Inner {};
const mark = Symbol("mark");
const bare = Symbol();
const holder = {
  method(a: number): void {},
  arrow: (a: number): void => {},
  plain: function (a: number): void {},
  [mark](a: number): void {},
  [bare](a: number): void {},
  get got(): number {
    return 1;
  },
  5(a: number): void {},
  "with space"(a: number): void {},
};
let assignedLater: (a: number) => void;
assignedLater = a => {};
const [fromPattern = (a: number): void => {}] = [];
const { fromObject = (a: number): void => {} }: { fromObject?: (a: number) => void } = {};
const conditional = none.length === 0 ? (a: number): void => {} : none;
const wrapped = ((a: number): void => {});
const viaComma = (none(), (a: number): void => {});

function shape(f: Function): string {
  return JSON.stringify(f.name) + "/" + f.length;
}

const all: [string, Function][] = [
  ["none", none], ["one", one], ["optional", optional], ["only optional", onlyOptional], ["defaulted", defaulted],
  ["default first", defaultFirst], ["default in the middle", defaultInTheMiddle], ["rest", rest], ["one and rest", oneAndRest],
  ["pattern", pattern], ["pattern with a default", patternWithDefault], ["a this parameter", withThis], ["overloaded", overloaded],
  ["generator", generator], ["async", asynchronous], ["async generator", asyncGenerator],
  ["a class", Plain], ["a class with a constructor", WithConstructor], ["derived", Derived], ["derived with fields", DerivedWithFields],
  ["a method", WithConstructor.prototype.method], ["a static method", WithConstructor.fixed],
  ["an arrow", arrow], ["anonymous", anonymous], ["named", named], ["a class expression", classExpression], ["a named class expression", namedClassExpression],
  ["an object's method", holder.method], ["an object's arrow", holder.arrow], ["an object's function", holder.plain],
  ["a symbol key", holder[mark]], ["a symbol without a description", holder[bare]], ["a numeric key", holder[5]], ["a key with a space", holder["with space"]],
  ["assigned later", assignedLater], ["a default in an array pattern", fromPattern], ["a default in an object pattern", fromObject],
  ["out of a conditional", conditional], ["in parentheses", wrapped], ["after a comma", viaComma],
  ["bound", one.bind(null)], ["bound with an argument", optional.bind(null, 1)], ["bound twice", one.bind(null).bind(null)],
  ["a field that is an arrow", new WithConstructor(1, 2).field],
];

for (const [label, f] of all) console.log(label + ": " + shape(f));

console.log("a computed method: " + Object.getOwnPropertyNames(WithConstructor.prototype).join());
console.log("a private method: " + new WithConstructor(1, 2).hiddenShape());
const accessor = Object.getOwnPropertyDescriptor(WithConstructor.prototype, "value");
console.log("a getter and a setter: " + (accessor?.get ? shape(accessor.get) : "none") + " " + (accessor?.set ? shape(accessor.set) : "none"));
const got = Object.getOwnPropertyDescriptor(holder, "got");
console.log("an object's getter: " + (got?.get ? shape(got.get) : "none"));
console.log("descriptors: " + JSON.stringify(Object.getOwnPropertyDescriptor(one, "length")) + " " + JSON.stringify(Object.getOwnPropertyDescriptor(one, "name")));
console.log("own names: " + Object.getOwnPropertyNames(one).sort().join() + " | " + Object.getOwnPropertyNames(arrow).sort().join() + " | " + Object.getOwnPropertyNames(Plain).sort().join());
