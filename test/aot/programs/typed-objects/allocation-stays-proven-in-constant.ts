// A constant is stored to once, by its initializer. Where that is a `new`, or a call of a static of the engine's own class, the constant holds what was made: behind the head of a loop, in a closure, in another function of the module. A look-alike that is cast to ArrayBuffer passes, the place that receives it takes it, and its own `byteLength` is read.
// IR= 1 inALoop : (number|i32|int\S*) = CallBuiltin .* overload=ArrayBufferPrototypeByteLength/
// IR= 1 ofTheModule : ArrayBuffer\S* = GetModuleVariable
// IR= 1 ofTheModule : (number|i32|int\S*) = CallBuiltin .* overload=ArrayBufferPrototypeByteLength/
// IR= 1 awaited : object .*= GetModuleVariable
// IR= 1 given : undefined.\S+ = PropGet .* name="byteLength"
const shared = new ArrayBuffer(24);
const settled = Promise.resolve(7);
function inALoop(n: number): number { const buffer = new ArrayBuffer(n); let sum = 0; for (let i = 0; i < 3; i++) sum += buffer.byteLength; return sum }
function inAClosure(n: number): () => number { const buffer = new ArrayBuffer(n); return () => buffer.byteLength }
function ofTheModule(): number { return shared.byteLength }
function given(buffer: ArrayBuffer): number { return buffer.byteLength }
async function awaited(): Promise<number> { let sum = 0; for (let i = 0; i < 3; i++) sum += await settled; return sum }
(globalThis as { kept?: unknown }).kept = [inALoop, inAClosure, ofTheModule, given, awaited];
console.log(inALoop(8), inAClosure(16)(), ofTheModule(), given(shared));
try { console.log(given({ byteLength: 5 } as unknown as ArrayBuffer)); } catch (e) { console.log("a look-alike:", (e as Error).constructor.name); }
awaited().then(sum => console.log(sum));
