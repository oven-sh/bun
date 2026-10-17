// `delete` inside a node:vm context removes the property from the object that is the context's global object. The object may be a typed object.
import vm from "node:vm";
type Sandbox = { alpha?: number; beta: string };
class Box {
  alpha?: number = 3;
  beta = "box";
}
const record: Sandbox = { alpha: 1, beta: "record" };
for (const sandbox of [record, new Box()]) {
  const context = vm.createContext(sandbox);
  console.log(vm.runInContext("delete globalThis.alpha", context), vm.runInContext("typeof alpha", context), vm.runInContext("'alpha' in globalThis", context));
  console.log("alpha" in sandbox, sandbox.alpha, JSON.stringify(sandbox));
}
