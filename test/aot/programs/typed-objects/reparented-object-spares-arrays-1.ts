// An object of the program is given another object of the program for its prototype, by a store to __proto__. That is nobody's business but theirs: the arrays of the program keep their storage. (`describe` is the shell's; without it the lines say false.)
const describe = (globalThis as any).describe as undefined | ((value: unknown) => string);
const arraysAreSlow = (): boolean => typeof describe === "function" && describe([1, 2, 3].concat([4])).includes("SlowPut");
const t = { a() { return "a"; }, b() { return "b"; } };
const heir: any = Object.create(t);
console.log("before:", arraysAreSlow(), heir.a(), typeof heir.extra);
(t as any).__proto__ = { extra() { return "x"; } };
console.log("behind:", arraysAreSlow(), (t as any).extra(), t.a(), t.b(), heir.a(), heir.extra(), Object.keys(t).join(), "extra" in t, Object.hasOwn(t, "extra"));
const list = [1, 2, 3]; list.push(4); list[6] = 7;
console.log(list.join(), list.length, arraysAreSlow());
