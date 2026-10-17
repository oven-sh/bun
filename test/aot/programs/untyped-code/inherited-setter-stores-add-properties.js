"use strict";
// A store by name finds a setter on the prototype chain, and the setter gives the receiver a new property.
// Constructor functions in the style of node:http do this for every object they make.
const kChunked = Symbol("chunked");
const log = [];

function Message() {
  this.size = 0;
  this.chunked = false;
  this.keepAlive = true;
  this.finished = false;
}
Object.defineProperty(Message.prototype, "chunked", {
  get() { return this[kChunked]; },
  set(value) { this[kChunked] = value; },
  configurable: true,
});
Object.defineProperty(Message.prototype, "keepAlive", {
  get() { return this._keepAlive; },
  set(value) { this._keepAlive = value; },
  configurable: true,
});

function Response() {
  Message.call(this);
  this.status = 200;
}
Object.setPrototypeOf(Response.prototype, Message.prototype);

function assign(message, socket) {
  message.socket = socket;
}
Object.defineProperty(Response.prototype, "socket", {
  get() { return this._socket; },
  set(value) {
    this._socket = value;
    this.assigned = (this.assigned || 0) + 1;
  },
  configurable: true,
});

function describe(object) {
  return Reflect.ownKeys(object).map(key => String(key) + "=" + String(object[key])).join(",");
}

let seen = new Set();
for (let i = 0; i < 300; i++) {
  const response = new Response();
  assign(response, i & 1 ? "odd" : "even");
  if (i % 50 === 0) assign(response, "again");
  seen.add(describe(response));
}
log.push([...seen].sort().join(" | "));

// The setter is replaced: the next store must call the new one.
Object.defineProperty(Message.prototype, "chunked", {
  get() { return "replaced"; },
  set(value) { this.replacedWith = value; },
  configurable: true,
});
seen = new Set();
for (let i = 0; i < 300; i++) seen.add(describe(new Response()));
log.push([...seen].join(" | "));

// A prototype in between gets a data property of the name: the store now makes an own property.
Object.defineProperty(Response.prototype, "keepAlive", { value: "shadow", writable: true, configurable: true });
seen = new Set();
for (let i = 0; i < 300; i++) seen.add(describe(new Response()));
log.push([...seen].join(" | "));

// The property in between is read-only: the store throws in strict code.
Object.defineProperty(Response.prototype, "keepAlive", { value: "fixed", writable: false, configurable: true });
try {
  new Response();
  log.push("no error");
} catch (error) {
  log.push(error.constructor.name);
}
delete Response.prototype.keepAlive;

// The accessor goes away: the store makes an own property.
delete Message.prototype.chunked;
seen = new Set();
for (let i = 0; i < 300; i++) seen.add(describe(new Response()));
log.push([...seen].join(" | "));

// An accessor without a setter: the store throws in strict code.
Object.defineProperty(Message.prototype, "chunked", { get() { return 1; }, configurable: true });
try {
  new Response();
  log.push("no error");
} catch (error) {
  log.push(error.constructor.name);
}
delete Message.prototype.chunked;

// A setter that changes the prototype of the receiver, one that throws now and then, and one that stores to the same name on another object.
const other = { __proto__: null };
const plainPrototype = { kind: "plain" };
function Odd(i) {
  this.index = i;
  this.moves = i;
  this.fails = i;
  this.forwards = i;
}
Object.defineProperties(Odd.prototype, {
  moves: { set(value) { this.moved = value; if (value % 7 === 0) Object.setPrototypeOf(this, plainPrototype); }, configurable: true },
  fails: { set(value) { if (value % 11 === 0) throw new RangeError("eleven"); this.passed = value; }, configurable: true },
  forwards: { set(value) { other.forwards = value; this.forwarded = true; }, configurable: true },
});
let digest = 0;
let errors = 0;
for (let i = 1; i <= 500; i++) {
  try {
    const odd = new Odd(i);
    digest = (digest * 31 + Reflect.ownKeys(odd).length * 7 + (Object.getPrototypeOf(odd) === plainPrototype ? 3 : 1) + other.forwards) | 0;
  } catch (error) {
    errors += error instanceof RangeError ? 1 : 1000;
  }
}
log.push(digest + " " + errors);

// Receivers of several shapes at one site, and receivers that already have the property the setter adds.
function mark(object, value) {
  object.mark = value;
}
const base = { set mark(value) { this.marked = value; } };
let shapes = 0;
for (let i = 0; i < 400; i++) {
  const object = Object.create(base);
  if (i & 1) object.a = 1;
  if (i & 2) object.b = 2;
  if (i & 4) object.marked = "before";
  mark(object, i);
  mark(object, i + 1);
  shapes = (shapes * 17 + Object.keys(object).join("").length + object.marked) | 0;
}
log.push(String(shapes));

// A primitive receiver and a frozen one.
try {
  mark(5, "five");
  log.push("no error");
} catch (error) {
  log.push(error.constructor.name);
}
const frozen = Object.freeze(Object.create(base));
try {
  mark(frozen, 1);
  log.push("no error");
} catch (error) {
  log.push(error.constructor.name);
}

console.log(log.join("\n"));
