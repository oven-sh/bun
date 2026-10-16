// A module whose bytes are written in the program is compiled when the program is built: no function of it is interpreted.
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

const instance = new WebAssembly.Instance(new WebAssembly.Module(bytesOf("AGFzbQEAAAABBwFgAn9/AX8DAgEABwcBA2FkZAAACgkBBwAgACABags=")), {});
const add = instance.exports.add as (a: number, b: number) => number;
console.log(add(2, 3), add(-1, 1), add(2147483647, 1), add(1.9, 2.9));
let sum = 0;
for (let i = 0; i < 100000; i++) sum = add(sum, i);
console.log(sum);
