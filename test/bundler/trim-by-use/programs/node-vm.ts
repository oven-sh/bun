import vm from "node:vm";
const context = vm.createContext({ seed: 20, out: [] as number[] });
console.log(vm.runInContext("out.push(seed + 1); seed * 2 + 2", context), (context as any).out.join());
console.log(vm.runInNewContext("typeof process + ' ' + answer", { answer: 42 }));
const script = new vm.Script("this.count = (this.count || 0) + 1");
console.log(script.runInContext(context), script.runInContext(context), vm.isContext(context), vm.isContext({}));
try {
  vm.runInNewContext("throw new TypeError('inside')");
} catch (error) {
  console.log((error as Error).message);
}
console.log(vm.compileFunction("return a + b", ["a", "b"])(40, 2));
