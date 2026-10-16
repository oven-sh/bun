// An object of the program is given another object of the program for its prototype, by Object.setPrototypeOf. That is nobody's business but theirs: the arrays of the program keep their storage. (`describe` is the shell's; without it the lines say false.)
const describe = (globalThis as any).describe as undefined | ((value: unknown) => string);
const arraysAreSlow = (): boolean => typeof describe === "function" && describe([1, 2, 3].concat([4])).includes("SlowPut");
function attempt(name: string, f: () => unknown): void { try { console.log(name, String(f()), arraysAreSlow()); } catch (e) { console.log(name, "throws", (e as Error).constructor.name, arraysAreSlow()); } }
const proto = { hello() { return "h"; } };
const a = { x: 1, y: "y" };
const heir: any = Object.create(a);
attempt("before:", () => [heir.x, typeof heir.hello].join());
attempt("another object of the program:", () => { Object.setPrototypeOf(a, proto); return [(a as any).hello(), a.x, a.y, heir.hello(), Object.getPrototypeOf(a) === proto, Object.keys(a).join()].join(); });
attempt("the same again:", () => { Object.setPrototypeOf(a, proto); return Object.getPrototypeOf(a) === proto; });
attempt("a cycle:", () => Object.setPrototypeOf(proto, heir));
attempt("null:", () => { const b = { z: 2 }; Object.setPrototypeOf(b, null); return [Object.getPrototypeOf(b), b.z, "toString" in b].join(); });
attempt("one that is not extensible:", () => { const c = Object.preventExtensions({ w: 3 }); return Object.setPrototypeOf(c, proto); });
attempt("Reflect.setPrototypeOf of one that is not extensible:", () => Reflect.setPrototypeOf(Object.preventExtensions({ v: 4 }), proto));
attempt("with properties that were added:", () => { const d: any = { u: 5 }; d.added = 6; d[0] = "zero"; Object.setPrototypeOf(d, proto); return [d.hello(), d.u, d.added, d[0], Object.keys(d).join()].join(); });
const list = [1, 2, 3]; list.push(4); list[6] = 7;
console.log(list.join(), list.length, arraysAreSlow());
