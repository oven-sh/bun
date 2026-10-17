// Every instance has a memory of its own, and all of them are alive at once: the compiled code runs with each.
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

const module = new WebAssembly.Module(bytesOf("AGFzbQEAAAABBwFgAn9/AX8DAgEABQQBAQECBxECBHBva2UAAAZtZW1vcnkCAAoTAREAIAAgATYCACAAKAIAQQFqCw=="));
const instances: WebAssembly.Instance[] = [];
for (let i = 0; i < 40; i++) instances.push(new WebAssembly.Instance(module, {}));
let sum = 0;
for (let i = 0; i < instances.length; i++) sum += (instances[i].exports.poke as (at: number, value: number) => number)(i * 4, i * 10);
console.log(sum);
console.log(instances.map((instance, i) => new Int32Array((instance.exports.memory as WebAssembly.Memory).buffer)[i]).join());
console.log(outcomeOf(() => (instances[39].exports.poke as (at: number, value: number) => number)(65536, 1)));
