// Vectors of 128 bits, with constants.
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

const e = new WebAssembly.Instance(new WebAssembly.Module(bytesOf("AGFzbQEAAAABCwJgAn9/AGABfwF/AwMCAAEFAwEAAQcXAwNhZGQAAARsYXN0AAEGbWVtb3J5AgAKUQIrACAAIAD9AAQAIAH9AAQA/a4B/QwBAgMEBQYHCAkKCwwNDg8Q/VH9CwQACyMAIAD9AAQAIAD9AAQA/Q0MDQ4PCAkKCwQFBgcAAQID/RsACw==")), {}).exports as any;
const words = new Int32Array(e.memory.buffer, 0, 8);
for (let i = 0; i < 8; i++) words[i] = (i + 1) * 1000;
e.add(0, 16);
console.log(words.join());
console.log(e.last(0), e.last(16), outcomeOf(() => e.last(65521)));
