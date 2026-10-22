// A record made by one literal held to an interface whose members are keyed by imported symbols, then given a prototype; untyped code reaches the same fields by the same symbols.
// IR+ ^layout L[0-9]+ name="Response" (?!.*isNeverAllocated=true)
// IR= 1 make NewObject \(v[0-9]+(, v[0-9]+){8}\)
// IR= 0 make (ElemSet|ElemDefine|GetModuleVariable)
// IR= 0 finish ElemGet
// IR= 0 end (ElemGet|ElemSet)
// IR= 0 header (ElemGet|ElemSet)
import { make, finish } from "./typed.ts";
import { kHandle, kState, kCallback, kSocket } from "./symbols.ts";
let total = 0;
let called = 0;
for (let i = 0; i < 2000; i++) {
  const response = make("/json", { id: 1 });
  response[kCallback] = () => { called++; };
  response[kSocket] = response[kHandle];
  response.header("a", "b");
  response.end();
  total += finish(response) + response[kState] + response[kSocket].id;
}
console.log(total, called);
const one = make("/x", null);
console.log(Reflect.ownKeys(one).map(String).join(), one.header("x", "y"), one.header("z", "y"), typeof one.end, Object.getPrototypeOf(one).constructor.name);
