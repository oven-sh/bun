// A constructor calls the one above it and then stores in a row: to names the parent has given the object already and to new ones, as Node's ServerResponse does behind OutgoingMessage.
// What the objects have and in which order. Only the jsc shell can count. Elsewhere the program checks the answers alone.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const kState = Symbol("kState");
const kPending = Symbol("kPending");
function Message() {
  this.chunked = false;
  this.sendDate = false;
  this.finished = true;
  this[kState] = "message";
  this.header = null;
}
function Response(request) {
  Message.call(this);
  this.chunked = true;
  this.request = request;
  this.sendDate = true;
  this.sent100 = false;
  this[kState] = "response";
  this[kPending] = [];
  this.finished = false;
}
Object.setPrototypeOf(Response.prototype, Message.prototype);
class State {
  mark;
  length;
  callback;
  index;
  pending;
  flags;
  constructor(mark, callback) {
    this.mark = mark;
    this.length = 0;
    this.index = 0;
    this.pending = null;
    this.flags = mark > 1 ? 3 : 1;
    this.callback = callback;
  }
}
function describe(object) {
  return Reflect.ownKeys(object).map(key => String(key) + "=" + JSON.stringify(object[key])).join(" ");
}

const said = new Set();
const counts = typeof aotOperationCount === "function";
for (let i = 0; i < 3000; i++) {
  said.add(describe(new Response("r")));
  said.add(describe(new State(i & 3, null)));
}
const learnt = count("operationAOTTryPutProperties");
console.log([...said].join("\n"));
console.log(!counts || (learnt >= 1 && learnt <= 300) ? "the stores were learnt together" : "stores of which some find their names there were learnt " + learnt + " times");

// The second constructor on what the first has not filled, or has filled otherwise.
const log = [];
function fill(object) {
  if (object.touched) return;
  object.touched = true;
  object.chunked = 1;
  object.request = 2;
  object.sendDate = 3;
  object.sent100 = 4;
  object.finished = 5;
}
function tried(name, object) {
  let thrown = "";
  try {
    fill(object);
  } catch (error) {
    thrown = " " + error.constructor.name;
  }
  console.log(name + ": " + describe(object) + thrown + (log.length ? " | " + log.splice(0).join() : ""));
}
for (let i = 0; i < 40; i++) fill({ chunked: 0, sendDate: 0, finished: 0 });
tried("as a rule", { chunked: 0, sendDate: 0, finished: 0 });
tried("all are new", {});
tried("all are there", { finished: 0, sent100: 0, sendDate: 0, request: 0, chunked: 0 });
tried("another order", { finished: 0, chunked: 0, sendDate: 0 });
const setter = { chunked: 0, finished: 0 };
Object.defineProperty(setter, "sendDate", { get() { return "got"; }, set(value) { log.push("set " + value + " behind " + Object.keys(this).join()); }, enumerable: true, configurable: true });
tried("one has a setter", setter);
tried("a new one meets an inherited setter", Object.create({ set sent100(value) { log.push("inherited " + value + " behind " + Object.keys(this).join()); } }, { chunked: { value: 0, writable: true, enumerable: true, configurable: true } }));
tried("a new one is read-only above", Object.create(Object.freeze({ request: "fixed" }), { chunked: { value: 0, writable: true, enumerable: true, configurable: true } }));
tried("one is read-only", Object.defineProperty({ chunked: 0, sendDate: 0, finished: 0 }, "sendDate", { writable: false }));
tried("not extensible", Object.preventExtensions({ touched: 0, chunked: 0, sendDate: 0, finished: 0 }));
tried("sealed with all", Object.seal({ touched: 0, chunked: 0, request: 0, sendDate: 0, sent100: 0, finished: 0 }));
tried("frozen", Object.freeze({ touched: 0, chunked: 0, sendDate: 0, finished: 0 }));
const wide = {};
for (let i = 0; i < 70; i++) wide["w" + i] = i;
wide.sendDate = 0;
fill(wide);
console.log(Object.keys(wide).slice(-7).join(), wide.sendDate, wide.finished);
const parent = { chunked: 0, sendDate: 0, finished: 0 };
const child = Object.create(parent);
tried("a prototype", parent);
tried("its heir", child);
tried("a proxy", new Proxy({ chunked: 0 }, { set(target, key, value) { log.push("set " + String(key)); target[key] = value; return true; } }));

// What comes to stand in the way later is seen at once.
function define(object, name, descriptor) { Object.defineProperty(object, name, descriptor); }
const above = Object.getPrototypeOf(Object.getPrototypeOf(new Response("x")));
define(above, "sent" + "100", { get() { return "late"; }, set(value) { log.push("late setter " + value + " behind " + Object.keys(this).join()); }, configurable: true });
console.log(describe(new Response("y")), log.splice(0).join());
delete above["sent" + "100"];
console.log(describe(new Response("z")), log.length);
