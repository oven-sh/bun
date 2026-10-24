// node:vm makes an object the global object of a context. The object may be a typed object: its properties are listed, read and written from inside.
import vm from "node:vm";
type Sandbox = { alpha: number; beta: string };
class Box {
  alpha = 3;
  beta = "box";
}
const record: Sandbox = { alpha: 1, beta: "record" };
for (const sandbox of [record, new Box()]) {
  const context = vm.createContext(sandbox);
  console.log(vm.runInContext("Object.keys(globalThis).join()", context));
  console.log(vm.runInContext("Object.getOwnPropertyNames(globalThis).filter(name => name === 'alpha' || name === 'beta').join()", context));
  console.log(vm.runInContext("let names = []; for (const name in globalThis) names.push(name); names.join()", context));
  console.log(vm.runInContext("alpha + beta", context), vm.runInContext("'alpha' in globalThis", context));
  vm.runInContext("alpha = alpha + 1; beta = beta + '!'", context);
  console.log(sandbox.alpha, sandbox.beta);
}
