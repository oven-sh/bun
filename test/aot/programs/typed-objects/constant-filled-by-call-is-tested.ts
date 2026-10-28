// The other side of allocation-stays-proven-in-constant: only what is seen to be made is proven without a test. A constant filled by a function of the program, by a cast, by a static that the program has put in the engine's place, or a variable that is stored to again, is not proven to hold what its written type says: a cast takes any object, undefined and null, so a look-alike goes through and its own members are read. A primitive throws a TypeError at the cast.
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
const attempt = (f: () => unknown): string => { try { return String(f()); } catch (e) { return (e as Error).constructor.name; } };
for (const value of [new ArrayBuffer(2), new Uint8Array(3), { byteLength: "many" }, "text", 5]) console.log(attempt(() => byACall(value)), attempt(() => byACast(value)), attempt(() => storedAgain(value)), attempt(() => shadowed(value)));
console.log(String(storedAgain(undefined)));
