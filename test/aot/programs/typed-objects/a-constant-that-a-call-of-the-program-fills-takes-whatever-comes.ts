// The other side of what-is-made-keeps-its-fact-in-a-constant: only what is seen to be made is a fact. A constant filled by a function of the program, by a cast, by a static that the program has put in the engine's place, or a variable that is stored to again, holds what its type claims, and the claim may be wrong.
// VALIDATED compiles
function claim(value: unknown): ArrayBuffer { return value as ArrayBuffer }
function byACall(value: unknown): unknown { const buffer = claim(value); return buffer.byteLength }
function byACast(value: unknown): unknown { const buffer = value as ArrayBuffer; return buffer.byteLength }
function storedAgain(value: unknown): unknown { let buffer = new ArrayBuffer(4); if (value !== undefined) buffer = value as ArrayBuffer; return buffer.byteLength }
function shadowed(value: unknown): unknown {
  const Promise = { resolve(given: unknown): globalThis.Promise<number> { return given as globalThis.Promise<number> } };
  const settled = Promise.resolve(value);
  return typeof settled;
}
for (const value of [new ArrayBuffer(2), new Uint8Array(3), { byteLength: "many" }, "text", 5]) console.log(String(byACall(value)), String(byACast(value)), String(storedAgain(value)), String(shadowed(value)));
console.log(String(storedAgain(undefined)));
