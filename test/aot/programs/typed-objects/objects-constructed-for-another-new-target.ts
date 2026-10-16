// Reflect.construct() of a class with another new.target: the object inherits from new.target.prototype, has what the constructor of the class gives it, and instanceof goes by its prototype chain.
const attempt = (run: () => unknown): string => { try { return String(run()); } catch (error) { return "throws " + (error as Error).name + ": " + (error as Error).message.slice(0, 60); } };
class A { x = 1; who: string; constructor() { this.who = new.target.name; } hi(): string { return "A.hi"; } }
class B { y = 2; hi(): string { return "B.hi"; } }
class SubA extends A { z = 3; override hi(): string { return "SubA.hi"; } }
function F(this: any) {} F.prototype.hi = function () { return "F.hi"; };
function Sub5(this: any): any { return Reflect.construct(A, [], Sub5); }
Object.setPrototypeOf(Sub5.prototype, A.prototype); Object.setPrototypeOf(Sub5, A); Sub5.prototype.hi = function () { return "Sub5.hi"; };
const tell = (made: any, target: any): string => [made instanceof target, made instanceof A, Object.getPrototypeOf(made) === target.prototype, made.hi?.(), made.who, JSON.stringify(made), Object.keys(made).join()].join(" ");
console.log("another class:", attempt(() => tell(Reflect.construct(A, [], B), B)));
console.log("a plain function:", attempt(() => tell(Reflect.construct(A, [], F), F)));
console.log("Object:", attempt(() => tell(Reflect.construct(A, [], Object), Object)));
console.log("its own subclass:", attempt(() => tell(Reflect.construct(A, [], SubA), SubA)));
console.log("itself:", attempt(() => tell(Reflect.construct(A, [], A), A)));
console.log("a subclass written as a function:", attempt(() => tell(new (Sub5 as any)(), Sub5)));
console.log("a bound function:", attempt(() => tell(Reflect.construct(A, [], F.bind(null)), F)));
console.log("a proxy:", attempt(() => { const asked: string[] = []; const proxy = new Proxy(F, { get(target, key, receiver) { asked.push(String(key)); return Reflect.get(target, key, receiver); } }); return tell(Reflect.construct(A, [], proxy), F) + " " + asked.join(); }));
console.log("a prototype that is no object:", attempt(() => { function G(this: any) {} G.prototype = 5 as any; return Object.getPrototypeOf(Reflect.construct(A, [], G)) === Object.prototype; }));
console.log("the subclass for the class it extends:", attempt(() => tell(Reflect.construct(SubA, [], A), A)));
console.log("an arrow function:", attempt(() => Reflect.construct(A, [], (() => 1) as any)));
console.log("a setter on the prototype:", attempt(() => { function Trap(this: any) {} Object.defineProperty(Trap.prototype, "who", { set() { throw new RangeError("the setter ran"); } }); return tell(Reflect.construct(A, [], Trap), Trap); }));
for (let i = 0; i < 300; i++) Reflect.construct(A, [], B);
console.log("after three hundred:", attempt(() => tell(Reflect.construct(A, [], B), B)));
console.log("new:", tell(new A(), A), "|", tell(new SubA(), SubA), "|", tell(new B(), B));

class L { a: number; constructor(a: number) { this.a = a; } }
class O { b?: string }
class T { a: number; constructor(a: number) { this.a = a; } }
class D extends T { constructor(a: number) { if (a) super(a); else super(0); } }
const made = Reflect.construct(L, [1], O), unknown: unknown = made;
console.log(made instanceof O, unknown instanceof O, made instanceof L, unknown instanceof L, Object.getPrototypeOf(made) === O.prototype, O[Symbol.hasInstance](made), L[Symbol.hasInstance](made));
const other = Reflect.construct(T, [2], O), hidden: unknown = other;
console.log(other instanceof O, hidden instanceof O, other instanceof T, hidden instanceof T, new D(1) instanceof T, new D(0).a, JSON.stringify(other));
console.log(attempt(() => { const made = Reflect.construct(O, [], L); return JSON.stringify(made) + " " + Object.keys(made).join() + " " + (Object.getPrototypeOf(made) === L.prototype); }));
