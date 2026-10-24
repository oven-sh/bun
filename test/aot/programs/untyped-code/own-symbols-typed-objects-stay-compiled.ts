// Object.getOwnPropertySymbols(x) where x is an object of a type of the program: by its type and through `any`. Without extra properties it has none, and the last line counts that this is said without entering the runtime.
declare const aotOperationCount: undefined | ((name: string) => number);
interface T { a?: number; b: number }
class Base { constructor(public v: number) {} #hidden = 1; get hidden() { return this.#hidden; } }
function hide(value: unknown): any { return value; }
function through(x: any) { return Object.getOwnPropertySymbols(x); }
function byType(x: T) { return Object.getOwnPropertySymbols(x); }
function ofInstance(x: Base) { return Object.getOwnPropertySymbols(x); }
const say = (list: symbol[]) => list.map(s => String(s)).join() + "|" + list.length + "|" + Array.isArray(list);
const s = Symbol("s"), t = Symbol.for("t");
const plain = (): any => JSON.parse('{"b":1}');
const x: T = { a: 1, b: 2 }, y: T = { b: 3 }, i = new Base(1);
console.log(say(through(x)), say(byType(x)), say(through(y)), say(through(i)), say(ofInstance(i)), say(through(plain())));
const first = through(x), second = through(x);
first.push(s);
console.log(first !== second, say(first), say(second), say(through(x)), Object.getPrototypeOf(second) === Array.prototype, Object.isFrozen(second));
hide(y)[s] = 1;
console.log(say(through(y)), say(byType(y)), say(through(x)));
hide(y)[t] = 2; hide(y).extra = 3;
console.log(say(through(y)), Object.keys(y).join());
delete hide(y)[s]; delete hide(y)[t];
console.log(say(through(y)), say(byType(y)));
delete hide(y).extra;
console.log(say(through(y)), say(byType(y)));
Object.defineProperty(hide(i), s, { value: 1, enumerable: false });
console.log(say(through(i)), say(ofInstance(i)), say(through(new Base(2))));
console.log([Object.freeze({ b: 1 } as T), Object.seal({ b: 1 } as T), Object.setPrototypeOf(hide({ b: 1 } as T), null), Object.setPrototypeOf(hide({ b: 1 } as T), { [s]: 1 })].map(o => say(through(o))).join(" "));
const withSymbol = plain(); withSymbol[s] = 1;
console.log([x, plain(), withSymbol, i, [1], "ab", 5, x, () => 1].map(o => say(through(o))).join(" "));
console.log([null, undefined].map(o => { try { return say(through(o)); } catch (e) { return (e as Error).name; } }).join());
const counted = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const other = new Base(3);
const before = counted("operationAOTOwnPropertyKeys");
let total = 0;
for (let k = 0; k < 1000; k++) total += through(x).length + byType(x).length + through(other).length + ofInstance(other).length;
console.log(total, counted("operationAOTOwnPropertyKeys") - before);
