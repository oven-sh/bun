// The names a parameter is asked for point to one literal. Other literals, instances, primitives and objects that changed arrive too, by calls, by call | apply | bind, as a callback and through a member.
function read(options) {
  let flags = 1;
  if (options && options.objectMode) flags |= 2;
  if (options && options.emitClose === false) flags |= 4;
  if (options && options.highWaterMark != null) flags |= options.highWaterMark << 4;
  return flags;
}
function State(options) {
  this.flags = read(options);
  this.mark = options ? 16 : 64;
  this.buffer = null;
  this.length = 0;
}
State.prototype = {};
Object.defineProperty(State.prototype, "isObjectMode", { get() { return (this.flags & 2) !== 0; } });
class Options { constructor(mark) { this.highWaterMark = mark; } get objectMode() { return this.highWaterMark > 2; } }
const usual = { objectMode: true, emitClose: false, autoDestroy: true };
const other = { read() {} };
const partial = { emitClose: false };
const below = Object.create(usual);
const changed = { objectMode: false, emitClose: true, autoDestroy: true };
delete changed.objectMode;
changed.highWaterMark = 3;
const withGetter = { get objectMode() { return "yes"; }, emitClose: false };
const frozen = Object.freeze({ objectMode: 0, emitClose: false, autoDestroy: false });
const all = [usual, other, partial, below, changed, withGetter, frozen, new Options(1), new Options(5), undefined, null, 0, 7, "", "text", true, Symbol.iterator, 10n, [], [1], () => 1, new Map(), /x/, new Proxy(usual, {}), new Proxy({}, { get: (target, name) => name === "emitClose" ? false : 2 })];
const out = [];
for (let round = 0; round < 3; round++) {
  for (const options of all) {
    const made = new State(options);
    out.push(made.flags, made.mark, made.isObjectMode, Object.keys(made).join());
  }
  out.push(all.map(read).join(), all.map(options => read.call(null, options)).join(), all.map(options => read.apply(null, [options])).join(), all.map(options => read.bind(null, options)()).join());
  out.push(read(), read(usual, other), Reflect.apply(read, undefined, [partial]), Reflect.construct(State, [other]).flags);
  const holder = { read };
  out.push(holder.read(other), holder["re" + "ad"](usual));
  if (round === 0) Object.setPrototypeOf(other, { objectMode: "inherited", get emitClose() { return false; } });
  if (round === 1) { Object.setPrototypeOf(other, null); partial.objectMode = 1; Object.defineProperty(State.prototype, "length", { set(value) { out.push("set " + value); }, configurable: true }); }
}
console.log(out.join(" "));
