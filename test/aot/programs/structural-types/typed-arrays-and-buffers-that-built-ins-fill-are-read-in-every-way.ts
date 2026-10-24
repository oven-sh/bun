function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
    return "[" + parts.join(", ") + "]";
  }
  if (typeof value === "object" && value !== null) return "{" + Object.keys(value).join() + "}";
  return String(value);
}

function attempt(label: string, run: () => unknown): void {
  try {
    console.log(label + " -> " + show(run()));
  } catch (error) {
    console.log(label + " threw " + (error instanceof Error ? error.constructor.name : typeof error));
  }
}

function total(numbers: Iterable<number>): number {
  let result = 0;
  for (const n of numbers) result += n;
  return result;
}

attempt("typed arrays from lists, sets and lengths", () => {
  const fromList = new Uint8Array([1, 2, 300]);
  const fromSet = new Float64Array(new Set([1.5, 2.5]));
  const empty = new Int32Array(2);
  const from = Int16Array.from([1, 2], n => n * 2);
  const of = Uint32Array.of(1, 2, 3);
  return [total(fromList), fromList[2], total(fromSet), total(empty), empty.length, total(from), total(of), of[5]];
});
attempt("what their methods return", () => {
  const source = new Float64Array([3, 1, 2]);
  return [
    [...source.map(n => n * 2)],
    [...source.filter(n => n > 1)],
    [...source.slice(1)],
    [...source.subarray(1)],
    [...source.toSorted()],
    [...source.toReversed()],
    [...source.with(0, 9)],
    source.at(-1),
    source.indexOf(2),
    source.join("+"),
    total(source.values()),
    [...source.entries()][1],
  ];
});
attempt("views of one buffer", () => {
  const bytes = new Uint8Array([1, 0, 0, 0, 2, 0, 0, 0]);
  const words = new Uint32Array(bytes.buffer);
  const view = new DataView(bytes.buffer);
  words[1] = 3;
  return [[...words], bytes[4], view.getUint32(0, true), view.getUint8(4), bytes.buffer.byteLength, new Uint8Array(bytes.buffer.slice(4))[0]];
});
attempt("a subarray shares and a slice does not", () => {
  const source = new Uint8Array([1, 2, 3]);
  const shared = source.subarray(1);
  const copy = source.slice(1);
  source[1] = 9;
  return [shared[0], copy[0]];
});
attempt("text to bytes and back", () => {
  const bytes = new TextEncoder().encode("hé");
  const into = new Uint8Array(4);
  const result = new TextEncoder().encodeInto("ab", into);
  return [[...bytes], bytes.length, new TextDecoder().decode(bytes), result.read + result.written, [...into]];
});
attempt("buffers", () => {
  const fromText = Buffer.from("abc");
  const fromList = Buffer.from([1, 2, 3]);
  const joined = Buffer.concat([fromText, fromList]);
  const json = fromList.toJSON();
  return [fromText[0] + 1, fromText.toString("hex"), total(fromList), joined.length, joined[3], json.type, total(json.data), Buffer.alloc(2, 7)[1], fromText.subarray(1).toString(), Buffer.byteLength("hé")];
});
attempt("numbers in buffers", () => {
  const buffer = Buffer.alloc(8);
  buffer.writeUInt16BE(258, 0);
  buffer.writeInt32LE(-2, 2);
  return [buffer.readUInt16BE(0) + 1, buffer.readInt32LE(2) + 1, buffer.readUInt8(1), [...buffer.subarray(0, 2)]];
});
attempt("base64 and hex", () => [btoa("ab"), atob("YWI="), Buffer.from("YWI=", "base64").toString(), new Uint8Array([1, 255]).toHex(), [...Uint8Array.fromHex("01ff")], new Uint8Array([97]).toBase64()]);
attempt("big integers in typed arrays", () => {
  const big = new BigInt64Array([1n, -2n]);
  return [big[0] + 1n, [...big.map(n => n * 2n)], big.length];
});
attempt("clamped and wrapped stores", () => {
  const clamped = new Uint8ClampedArray([300, -5, 1.5]);
  const wrapped = new Int8Array([200, -129]);
  const floats = new Float32Array([0.1]);
  return [[...clamped], [...wrapped], floats[0] === 0.1, floats[0] > 0.1];
});
attempt("past the end and odd keys", () => {
  const bytes = new Uint8Array(2);
  bytes[5] = 1;
  const odd: Record<string, number> = Object(bytes);
  odd["1.5"] = 2;
  odd["-0"] = 3;
  odd["name"] = 4;
  return [bytes[5], bytes.length, odd["1.5"], odd["-0"], odd["name"], Object.keys(bytes).join()];
});

export {};
