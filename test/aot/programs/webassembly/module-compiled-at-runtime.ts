// Bytes that nobody saw when the program was built are a module all the same: it is interpreted.
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

const numbers = [85, 52, 38, 56, 84, 85, 85, 85, 84, 82, 84, 53, 87, 42, 42, 84, 42, 86, 87, 84, 85, 82, 82, 84, 86, 52, 49, 49, 85, 85, 95, 92, 84, 82, 85, 117, 85, 117, 84, 63, 94];
const bytes = new Uint8Array(numbers.length);
for (let i = 0; i < numbers.length; i++) bytes[i] = numbers[i] ^ 0x55;
const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), {});
console.log((instance.exports.add as (a: number, b: number) => number)(20, 22));
console.log(outcomeOf(() => new WebAssembly.Module(bytesOf("AGFzbQEAAAABBwFgAn9/AX8DAgEABwcBA2FkZAAACgkBBwAgACABag=="))).slice(0, 40));
