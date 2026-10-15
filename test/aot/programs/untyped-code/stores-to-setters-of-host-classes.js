"use strict";
// A store by name finds an attribute that a class of the host implements with a setter in native code.
// node:http stores to such attributes of its native response three times for every request.
const log = [];
function first() { return 1; }
function second() { return 2; }

function listen(target, listener) {
  target.onabort = listener;
}

// One receiver, many times; then other receivers of the same class.
const signal = new AbortController().signal;
let kept = 0;
for (let i = 0; i < 300; i++) {
  listen(signal, i & 1 ? first : second);
  if (signal.onabort === (i & 1 ? first : second)) kept++;
}
log.push("kept " + kept);
let fresh = 0;
for (let i = 0; i < 300; i++) {
  const controller = new AbortController();
  let called = 0;
  listen(controller.signal, () => { called++; });
  controller.abort();
  fresh += called;
}
log.push("called " + fresh);

// What the setter does with values that are no functions.
for (const value of [null, undefined, 5, "text", {}, first]) {
  listen(signal, value);
  log.push(typeof value + " -> " + (signal.onabort === first ? "first" : String(signal.onabort)));
}

// A receiver that only inherits from an object of the class: the native setter sees a receiver that is not its own.
const heir = Object.create(signal);
for (let i = 0; i < 100; i++) {
  try {
    listen(heir, first);
    if (i === 99) log.push("heir: no error, own keys " + Object.keys(heir).length);
  } catch (error) {
    if (i === 99) log.push("heir: " + error.constructor.name);
  }
}

// An own property of the name hides the attribute from then on.
const hidden = new AbortController().signal;
for (let i = 0; i < 100; i++) listen(hidden, first);
Object.defineProperty(hidden, "onabort", { value: "own", writable: true, configurable: true });
for (let i = 0; i < 100; i++) listen(hidden, second);
log.push("hidden: " + (hidden.onabort === second) + " " + Object.keys(Object.getOwnPropertyDescriptors(hidden)).join());
delete hidden.onabort;
log.push("shown again: " + (hidden.onabort === first));

// The receiver gets other properties, so its shape changes between stores.
const grown = new AbortController().signal;
let shapes = 0;
for (let i = 0; i < 200; i++) {
  if (i % 40 === 0) grown["extra" + i] = i;
  listen(grown, i & 1 ? first : second);
  shapes += grown.onabort === (i & 1 ? first : second) ? 1 : 0;
}
log.push("grown " + shapes + " " + Object.keys(grown).length);

// The same site meets ordinary objects, objects with a setter in JavaScript, and frozen objects in between.
const plain = {};
const withSetter = { set onabort(value) { this.stored = value; } };
const frozen = Object.freeze({});
let mixed = 0;
for (let i = 0; i < 400; i++) {
  const target = [signal, plain, withSetter, frozen][i & 3];
  try {
    listen(target, first);
    mixed += 1;
  } catch (error) {
    mixed += error instanceof TypeError ? 1000 : 1000000;
  }
}
log.push("mixed " + mixed + " " + (plain.onabort === first) + " " + (withSetter.stored === first) + " " + (signal.onabort === first));

// Another class and another attribute at a site of their own.
const params = new URL("http://example.com/a?b=1");
let hrefs = 0;
for (let i = 0; i < 300; i++) {
  params.search = "?n=" + (i & 7);
  params.hash = i & 1 ? "#x" : "";
  hrefs += params.href.length;
}
log.push("hrefs " + hrefs);
try {
  params.href = "not a url";
  log.push("no error");
} catch (error) {
  log.push("href: " + error.constructor.name);
}

console.log(log.join("\n"));
