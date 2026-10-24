// A SharedArrayBuffer is not an ArrayBuffer, nor the other way round: the runtime type check of a parameter, of a field and of a result tells them apart, and a type that names both classes takes both.
class Holder {
  unshared: ArrayBuffer = new ArrayBuffer(1);
  shared: SharedArrayBuffer = new SharedArrayBuffer(2);
}
function takesUnshared(buffer: ArrayBuffer): number { return buffer.byteLength; }
function takesShared(buffer: SharedArrayBuffer): number { return buffer.byteLength; }
function takesEither(buffer: ArrayBuffer | SharedArrayBuffer): number { return buffer.byteLength; }
function storesUnshared(buffer: any): number { const holder = new Holder(); holder.unshared = buffer; return holder.unshared.byteLength; }
function storesShared(buffer: any): number { const holder = new Holder(); holder.shared = buffer; return holder.shared.byteLength; }
function returnsUnshared(buffer: any): ArrayBuffer { return buffer; }
function returnsShared(buffer: any): SharedArrayBuffer { return buffer; }
function sizeOfUnsharedResult(buffer: any): number { return returnsUnshared(buffer).byteLength; }
function sizeOfSharedResult(buffer: any): number { return returnsShared(buffer).byteLength; }
const untyped: any[] = [takesUnshared, takesShared, takesEither, storesUnshared, storesShared, sizeOfUnsharedResult, sizeOfSharedResult];
const given: any[] = [new ArrayBuffer(8), new SharedArrayBuffer(16), new Uint8Array(4), { byteLength: 32 }];
for (const f of untyped) {
  for (const value of given) {
    const tag = Object.prototype.toString.call(value);
    try { console.log(f.name, tag, f(value)); } catch (error) { console.log(f.name, tag, (error as Error).name); }
  }
}
