// A module whose bytes stand in the program as a data: URL is compiled when the program is built, however the program gets the bytes out of the URL: no function of it is interpreted.
// The same bytes behind several heads are one module, compiled once. The run time finds its code by the bytes, so also for a URL that the build does not look at: one whose head ends behind the 64th character, one that does not start with a small d.
// STATISTIC: WebAssemblyModulesFoundInText = 2
// STATISTIC: WebAssemblyModulesInTextDeclined = 0
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

type Unary = (n: number) => number;
type Binary = (a: number, b: number) => number;

function textOf(url: string): string {
  return url.slice(url.indexOf(",") + 1);
}

function exportsOf(bytes: BufferSource): Bun.WebAssembly.Exports {
  return new WebAssembly.Instance(new WebAssembly.Module(bytes), {}).exports;
}

// (func $multiply (export "multiply") (param i32 i32) (result i32) local.get 0 local.get 1 i32.mul)
// (func (export "square") (param i32) (result i32) local.get 0 local.get 0 call $multiply)
// (func (export "negate") (param i32) (result i32) i32.const 0 local.get 0 i32.sub)
const products = "data:application/wasm;base64,AGFzbQEAAAABDAJgAn9/AX9gAX8BfwMEAwABAQceAwhtdWx0aXBseQAABnNxdWFyZQABBm5lZ2F0ZQACChoDBwAgACABbAsIACAAIAAQAAsHAEEAIABrCw==";
const first = exportsOf(bytesOf(textOf(products)));
const multiply = first.multiply as Binary;
const square = first.square as Unary;
const negate = first.negate as Unary;
console.log("multiply", multiply(6, 7), multiply(-3, 5), multiply(65536, 65536), multiply(2.9, 3.9));
console.log("square", square(12), square(-12), square(46341));
console.log("negate", negate(5), negate(-5), negate(-2147483648), Object.is(negate(0), 0));
let product = 1;
for (let i = 1; i < 100000; i += 2) product = multiply(product, i);
console.log("many", product);

console.log("Buffer", (exportsOf(Buffer.from(textOf(products), "base64")).multiply as Binary)(6, 8));
console.log("atob", (exportsOf(Uint8Array.from(atob(textOf(products)), character => character.charCodeAt(0))).multiply as Binary)(6, 9));
console.log("fetch", (exportsOf(await (await fetch(products)).arrayBuffer()).multiply as Binary)(6, 10));

const sameBytes = "data:application/octet-stream;base64,AGFzbQEAAAABDAJgAn9/AX9gAX8BfwMEAwABAQceAwhtdWx0aXBseQAABnNxdWFyZQABBm5lZ2F0ZQACChoDBwAgACABbAsIACAAIAAQAAsHAEEAIABrCw==";
console.log("other head", (exportsOf(bytesOf(textOf(sameBytes))).square as Unary)(11), textOf(sameBytes) === textOf(products));

// (func (export "add") (param i32 i32) (result i32) local.get 0 local.get 1 i32.add)
// (func (export "divide") (param i32 i32) (result i32) local.get 0 local.get 1 i32.div_s)
// (func (export "sumTo") (param $n i32) (result i32) (local $sum i32) ..): $n + ($n - 1) + .. + 1 in a loop
const arithmetic = "data:application/wasm;base64,AGFzbQEAAAABDAJgAn9/AX9gAX8BfwMEAwAAAQcYAwNhZGQAAAZkaXZpZGUAAQVzdW1UbwACCjMDBwAgACABagsHACAAIAFtCyEBAX8CQANAIABFDQEgASAAaiEBIABBAWshAAwACwsgAQs=";
const second = (await WebAssembly.instantiate(bytesOf(textOf(arithmetic)), {})).instance.exports;
console.log("second module", (second.add as Binary)(40, 2), (second.divide as Binary)(85, 2), (second.sumTo as Unary)(1000));

const longHead = "data:application/wasm;name=a-module-with-a-rather-long-name-in-its-head;base64,AGFzbQEAAAABDAJgAn9/AX9gAX8BfwMEAwABAQceAwhtdWx0aXBseQAABnNxdWFyZQABBm5lZ2F0ZQACChoDBwAgACABbAsIACAAIAAQAAsHAEEAIABrCw==";
console.log("long head", longHead.indexOf("base64,"), (exportsOf(bytesOf(textOf(longHead))).negate as Unary)(20));

const capitals = "DATA:application/wasm;base64,AGFzbQEAAAABDAJgAn9/AX9gAX8BfwMEAwAAAQcYAwNhZGQAAAZkaXZpZGUAAQVzdW1UbwACCjMDBwAgACABagsHACAAIAFtCyEBAX8CQANAIABFDQEgASAAaiEBIABBAWshAAwACwsgAQs=";
console.log("capitals", (exportsOf(bytesOf(textOf(capitals))).sumTo as Unary)(20));

const sentence = "data:text/plain;base64,VGhpcyBpcyBubyBtb2R1bGU6IGl0IGlzIGEgc2VudGVuY2UgdGhhdCBpcyBsb25nIGVub3VnaCB0byBiZSBsb29rZWQgYXQu";
console.log("other data", await (await fetch(sentence)).text());
export {};
