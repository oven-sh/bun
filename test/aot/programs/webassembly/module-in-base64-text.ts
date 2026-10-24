// A module whose bytes stand in the program as base64 text is compiled when the program is built, however the program decodes the text and whichever call makes the module: no function of it is interpreted.
// Text that only starts as a module does gets no code, and text of under 64 characters is not looked at: that module is interpreted. Each of them behaves as in plain Bun.
// STATISTIC: WebAssemblyModulesFoundInText = 3
// STATISTIC: WebAssemblyModulesInTextDeclined = 1
// STATISTIC: WasmFunctionsCompiled = 6
// STATISTIC: WasmFunctionsInterpreted = 0
function bytesOf(text: string): Uint8Array<ArrayBuffer> {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const bytes: number[] = [];
  let bits = 0;
  let count = 0;
  for (const character of text) {
    if (character === "=") break;
    bits = ((bits << 6) | alphabet.indexOf(character)) & 0xffffff;
    count += 6;
    if (count >= 8) {
      count -= 8;
      bytes.push((bits >> count) & 255);
    }
  }
  return new Uint8Array(bytes);
}

function outcomeOf(run: () => unknown): string {
  try {
    return String(run());
  } catch (error) {
    const kind = error instanceof WebAssembly.RuntimeError ? "WebAssembly.RuntimeError" : (error as Error).name;
    const message = (error as Error).message;
    const hint = message.indexOf(" (evaluating");
    return kind + ": " + (hint < 0 ? message : message.slice(0, hint));
  }
}

type Unary = (n: number) => number;
type Binary = (a: number, b: number) => number;

// (func (export "add") (param i32 i32) (result i32) local.get 0 local.get 1 i32.add)
// (func (export "divide") (param i32 i32) (result i32) local.get 0 local.get 1 i32.div_s)
// (func (export "sumTo") (param $n i32) (result i32) (local $sum i32) ..): $n + ($n - 1) + .. + 1 in a loop
const arithmetic = "AGFzbQEAAAABDAJgAn9/AX9gAX8BfwMEAwAAAQcYAwNhZGQAAAZkaXZpZGUAAQVzdW1UbwACCjMDBwAgACABagsHACAAIAFtCyEBAX8CQANAIABFDQEgASAAaiEBIABBAWshAAwACwsgAQs=";
const first = new WebAssembly.Instance(new WebAssembly.Module(bytesOf(arithmetic)), {}).exports;
const add = first.add as Binary;
const divide = first.divide as Binary;
const sumTo = first.sumTo as Unary;
console.log("add", add(2, 3), add(-1, 1), add(2147483647, 1), add(1.9, 2.9));
console.log("divide", divide(7, 2), divide(-7, 2), outcomeOf(() => divide(1, 0)), divide(9, 3));
console.log("sumTo", sumTo(0), sumTo(10), sumTo(100000));
let sum = 0;
for (let i = 0; i < 100000; i++) sum = add(sum, i);
console.log("many", sum);

const decoded = Uint8Array.fromBase64(arithmetic);
console.log("fromBase64", (new WebAssembly.Instance(new WebAssembly.Module(decoded), {}).exports.add as Binary)(19, 23));
console.log("instantiate", ((await WebAssembly.instantiate(decoded, {})).instance.exports.add as Binary)(20, 23));
console.log("compile", (new WebAssembly.Instance(await WebAssembly.compile(decoded.buffer), {}).exports.add as Binary)(21, 23));

// (memory (export "memory") 1)
// (func (export "fibonacci") (param i32) (result i32) ..): calls itself twice
// (func (export "half") (param f64) (result f64) local.get 0 f64.const 0.5 f64.mul)
// (func (export "exchange") (param $address i32) (param $value i32) (result i32) ..): stores the value and returns what was there
const recursion = "AGFzbQEAAAABEQNgAX8Bf2ABfAF8YAJ/fwF/AwQDAAECBQMBAAEHKAQJZmlib25hY2NpAAAEaGFsZgABCGV4Y2hhbmdlAAIGbWVtb3J5AgAKQgMcACAAQQJIBH8gAAUgAEEBaxAAIABBAmsQAGoLCw4AIABEAAAAAAAA4D+iCxQBAX8gACgCACECIAAgATYCACACCw==";
const second = new WebAssembly.Instance(new WebAssembly.Module(bytesOf(recursion)), {}).exports;
const fibonacci = second.fibonacci as Unary;
const half = second.half as Unary;
const exchange = second.exchange as Binary;
const memory = second.memory as WebAssembly.Memory;
console.log("fibonacci", fibonacci(0), fibonacci(1), fibonacci(10), fibonacci(24));
console.log("half", half(3), half(0.1), Object.is(half(-0), -0), half(NaN), half(1e308));
console.log("exchange", exchange(0, 7), exchange(0, 9), exchange(65532, 1), outcomeOf(() => exchange(65533, 1)), outcomeOf(() => exchange(-4, 1)), exchange(65532, 2));
console.log("memory", new Uint32Array(memory.buffer)[0], memory.buffer.byteLength);

const truncated = "AGFzbQEAAAABDAJgAn9/AX9gAX8BfwMEAwAAAQcYAwNhZGQAAAZkaXZpZGUAAQVzdW1UbwACCjMDBwAgACABagsHACAA";
console.log("truncated", truncated.length, outcomeOf(() => new WebAssembly.Module(bytesOf(truncated))).slice(0, 12));

const sentence = "AGFzbQEAAA is how the base64 text of every WebAssembly module starts, and this text goes on as none does.";
console.log("sentence", sentence.length, outcomeOf(() => Uint8Array.fromBase64(sentence)).slice(0, 11));

// (func (export "add") (param i32 i32) (result i32) local.get 0 local.get 1 i32.add)
const shortText = "AGFzbQEAAAABBwFgAn9/AX8DAgEABwcBA2FkZAAACgkBBwAgACABags=";
console.log("short", shortText.length, (new WebAssembly.Instance(new WebAssembly.Module(bytesOf(shortText)), {}).exports.add as Binary)(22, 23));
export {};
