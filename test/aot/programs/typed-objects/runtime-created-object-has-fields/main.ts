// A class whose object is made by the run time (an heir in untyped text, `new` of a value, Reflect.construct) has the fields it is born with, each `undefined` until it is stored to.
import { Base } from "./base.ts";
import { Heir, viaValue } from "./heir.js";
function look(base: Base): string {
  return [base.link, base.other, base.word, base.any, base.flag, base.count, base.big, base.name].map(value => value === undefined ? "u" : String(value instanceof Base ? "B" : value)).join(",") + " " + base.run(1) + " " + base.twice(2) + " " + Object.keys(base).join("");
}
const made: Base[] = [new Heir("a") as Base, viaValue(Base, "b") as Base, Reflect.construct(Base, ["c"], Heir) as Base, Reflect.construct(Base, []) as Base, new Base("e")];
for (const base of made) console.log(look(base), base instanceof Heir, Object.getPrototypeOf(base) === Heir.prototype || Object.getPrototypeOf(base) === Base.prototype);
made[0].link = made[1]; made[0].any = 5; made[0].word = "w"; made[1].other = null; made[1].flag = false; made[1].count = 0; made[2].big = 7n; made[2].any = made[0];
for (const base of made) console.log(look(base));
let garbage: unknown[] = [];
for (let round = 0; round < 60; round++) { garbage = []; for (let i = 0; i < 400; i++) garbage.push(new Heir("g" + i)); }
console.log(look(garbage[399] as Base), look(made[0]), made[0].run === made[0].run, made[0].run === made[1].run);
