// Any callable value fits a function type, whatever its representation. Anything else throws a TypeError.
type Unary = (x: number) => number
function double(x: number): number { return x * 2 }
class Box { value = 1 }
function call(f: Unary): number { return f(-3) }
function kindOf(f: Unary): string { return typeof f }
function attempt(label: string, value: any) { try { console.log(label + ":", call(value)) } catch (e) { console.log(label + ":", e instanceof TypeError ? "TypeError" : "other " + e) } }

console.log("arrow function:", call(x => x + 1))
console.log("bound function:", call(double.bind(null)))
console.log("class:", kindOf(Box as any))
console.log("callable Proxy:", call(new Proxy(double, {})))
console.log("native function:", call(Math.abs))

attempt("object", {})
attempt("Proxy of an object", new Proxy({}, {}))
attempt("number", 1)
attempt("string", "f")
export {};
