import { visitors, type Visitors } from "./visitors";
type Everything = Parameters<Visitors[keyof Visitors]>[0] extends infer P ? P : never;
const all = { shared: { value: 100, children: [{ value: 1 }] }, own0: { value: { k0: 0 } }, own1: { value: { k1: 1 } }, own2: { value: { k2: 2 } }, own3: { value: { k3: 3 } }, own4: { value: { k4: 4 } }, own5: { value: { k5: 5 } }, own6: { value: { k6: 6 } }, own7: { value: { k7: 7 } }, own8: { value: { k8: 8 } }, own9: { value: { k9: 9 } }, own10: { value: { k10: 10 } }, own11: { value: { k11: 11 } }, own12: { value: { k12: 12 } }, own13: { value: { k13: 13 } }, own14: { value: { k14: 14 } }, own15: { value: { k15: 15 } }, own16: { value: { k16: 16 } }, own17: { value: { k17: 17 } }, own18: { value: { k18: 18 } }, own19: { value: { k19: 19 } } };
function visit(name: keyof Visitors): number {
  const visitor = visitors[name];
  return visitor(all);
}
let sum = 0;
for (const name of Object.keys(visitors) as (keyof Visitors)[]) sum += visit(name);
const one: Everything = all;
console.log(sum, visit("v7"), one.shared.children?.length);
