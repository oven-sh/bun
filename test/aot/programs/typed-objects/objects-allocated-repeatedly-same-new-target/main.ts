import * as core from "./core.ts";
import * as heirs from "./heirs.js";
const show = (label: string, value: unknown) => console.log(label + ": " + JSON.stringify(value));
const look = (o: any) => [o.describe(), Object.keys(o).join(), core.readLate(o), o instanceof core.Core, o.kind, typeof o.helper];

const first = heirs.make(heirs.Heir, 1);
core.fill(first, 7);
(first as any).extra = "of the first alone";
for (let i = 0; i < 6; i++) show("Heir " + i, look(heirs.make(heirs.Heir, i)));
show("the first", [look(first), (first as any).extra]);

for (let i = 0; i < 4; i++) show("Old " + i, [look(heirs.make(heirs.Old, i)), Object.getPrototypeOf(heirs.make(heirs.Old, i)) === heirs.Old.prototype]);
(heirs.Old as any).prototype = heirs.second;
for (let i = 0; i < 4; i++) show("Old with another prototype " + i, [look(heirs.make(heirs.Old, i)), Object.getPrototypeOf(heirs.make(heirs.Old, i)) === heirs.second]);
(heirs.Old as any).prototype = 5;
show("Old with no prototype object", Object.getPrototypeOf(heirs.make(heirs.Old, 1)) === Object.prototype);

let sum = 0;
for (let round = 0; round < 5; round++) {
  for (const C of heirs.many) {
    const o: any = heirs.make(C, round);
    sum += o.which() + o.count + (Object.getPrototypeOf(o) === C.prototype ? 1000 : 0);
  }
}
show("forty heirs in turn", sum);

for (let i = 0; i < 3; i++) {
  show("for one and for another " + i, [look(Reflect.construct(core.Core, [i], heirs.Heir)), look(Reflect.construct(core.Core, [i], heirs.Other)), look(Reflect.construct(heirs.Heir, [i], heirs.Other)), look(Reflect.construct(heirs.Other, [i], heirs.Heir))]);
  show("bound and proxied " + i, [look(heirs.make(heirs.bound, i)), look(heirs.make(heirs.proxied, i)), look(Reflect.construct(core.Core, [i], heirs.bound)), look(Reflect.construct(core.Core, [i], heirs.proxied))]);
}

const nameOfLate = ["la", "te"].join("");
heirs.addGetter(heirs.Heir.prototype, nameOfLate, "added later");
for (let i = 0; i < 3; i++) show("Heir with a getter " + i, look(heirs.make(heirs.Heir, i)));
delete (heirs.Heir.prototype as any)[nameOfLate];
for (let i = 0; i < 3; i++) show("Heir without it " + i, look(heirs.make(heirs.Heir, i)));
Object.setPrototypeOf(heirs.Heir.prototype, heirs.Other.prototype);
for (let i = 0; i < 3; i++) show("Heir below Other " + i, look(heirs.make(heirs.Heir, i)));
Object.setPrototypeOf(heirs.Heir.prototype, core.Core.prototype);
for (let i = 0; i < 3; i++) show("Heir below Core again " + i, look(heirs.make(heirs.Heir, i)));

const kept: any[] = [];
for (let i = 0; i < 3000; i++) {
  const o = heirs.make(heirs.Heir, i);
  if (i % 3 === 0) core.fill(o, i);
  if (i % 100 === 0) kept.push(o);
}
show("many", kept.map(o => o.describe()).join(" | "));
