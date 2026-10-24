// What comes out of a place for an Error, a Promise or an ArrayBuffer is a host object as before, and an interface of the program that it enters admits it: by a parameter, a field, an element.
interface HasMessage { message: string }
interface Thenable { then(done: (n: number) => void): unknown }
interface HasTime { getTime(): number }
interface HasBytes { byteLength: number }
class Own implements HasMessage { extra = 0; message = "own" }
class OwnThen implements Thenable { extra = 0; then(done: (n: number) => void): unknown { done(1); return 0 } }
class OwnTime implements HasTime { extra = 0; getTime(): number { return -1 } }
class OwnBytes implements HasBytes { extra = 0; byteLength = -1 }
function show(m: HasMessage): string { return m.message }
function wait(t: Thenable): string { return typeof t.then }
function time(t: HasTime): number { return t.getTime() }
function bytes(b: HasBytes): number { return b.byteLength }
function viaError(e: Error): string { return show(e) }
function viaPromise(p: Promise<number>): string { return wait(p) }
function viaDate(d: Date): number { return time(d) }
function viaBuffer(b: ArrayBuffer): number { return bytes(b) }
class Holder { e: Error; p: Promise<number>; d: Date; b: ArrayBuffer; constructor(e: Error, p: Promise<number>, d: Date, b: ArrayBuffer) { this.e = e; this.p = p; this.d = d; this.b = b } }
const h = new Holder(new RangeError("held"), Promise.resolve(2), new Date(9), new ArrayBuffer(3));
console.log(show(new Own()), wait(new OwnThen()), time(new OwnTime()), bytes(new OwnBytes()));
console.log(viaError(new Error("x")), viaError(new TypeError("y")), viaPromise(Promise.resolve(1)), viaDate(new Date(5)), viaBuffer(new ArrayBuffer(7)));
console.log(show(h.e), wait(h.p), time(h.d), bytes(h.b));
const list: HasMessage[] = [h.e, new Own()]; const times: HasTime[] = [h.d, new OwnTime()];
console.log(list.map(show).join(), times.map(time).join());
