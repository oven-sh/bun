// A place for an ArrayBuffer, an Error or a Promise takes whatever comes. A constant is no such place: it is stored to once, by its initializer. Where that is a `new`, or a call of a static of the engine's own class, the constant holds what was made: behind the head of a loop, in a closure, in another function of the module.
// IR= 1 inALoop : number = CallBuiltin .* ArrayBuffer.byteLength
// IR= 1 ofTheModule : ArrayBuffer = GetModuleVariable
// IR= 1 ofTheModule : number = CallBuiltin .* ArrayBuffer.byteLength
// IR= 1 awaited : object .*= GetModuleVariable
// IR= 1 given : undefined.number = GetById .* "byteLength"
const shared = new ArrayBuffer(24);
const settled = Promise.resolve(7);
function inALoop(n: number): number { const buffer = new ArrayBuffer(n); let sum = 0; for (let i = 0; i < 3; i++) sum += buffer.byteLength; return sum }
function inAClosure(n: number): () => number { const buffer = new ArrayBuffer(n); return () => buffer.byteLength }
function ofTheModule(): number { return shared.byteLength }
function given(buffer: ArrayBuffer): number { return buffer.byteLength }
async function awaited(): Promise<number> { let sum = 0; for (let i = 0; i < 3; i++) sum += await settled; return sum }
(globalThis as { kept?: unknown }).kept = [inALoop, inAClosure, ofTheModule, given, awaited];
console.log(inALoop(8), inAClosure(16)(), ofTheModule(), given(shared), given({ byteLength: 5 } as unknown as ArrayBuffer));
awaited().then(sum => console.log(sum));
