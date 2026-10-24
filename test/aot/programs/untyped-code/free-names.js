// Free names in sloppy code: read, typeof, store and delete of a name nothing declares, of a global variable, of a read-only global property, and of a property that changes under a loop.
module.exports = {};

function attempt(run) {
  try {
    return run();
  } catch (error) {
    return error.constructor.name;
  }
}

console.log(attempt(() => undeclared), typeof undeclared, delete undeclared);
undeclared = 1;
console.log(undeclared, typeof undeclared, globalThis.undeclared, Object.getOwnPropertyDescriptor(globalThis, "undeclared").configurable);
undeclared = 2;
console.log(undeclared, delete undeclared, typeof undeclared, attempt(() => undeclared));

(0, eval)("var declaredGlobal = 3");
console.log(declaredGlobal, typeof declaredGlobal);
declaredGlobal = 4;
console.log(globalThis.declaredGlobal, delete declaredGlobal, typeof declaredGlobal);

globalThis.readOnlyName = 5;
Object.defineProperty(globalThis, "readOnlyName", { writable: false });
readOnlyName = 6;
console.log(readOnlyName, globalThis.readOnlyName);
class Strict {
  static storeReadOnly() {
    readOnlyName = 7;
  }
  static storeUndeclared() {
    neverDeclared = 8;
  }
}
console.log(attempt(Strict.storeReadOnly), attempt(Strict.storeUndeclared), readOnlyName, typeof neverDeclared);
console.log(delete readOnlyName, typeof readOnlyName);

globalThis.changing = 0;
function readChanging() {
  return changing;
}
function storeChanging(value) {
  changing = value;
}
const reads = [];
for (let round = 0; round < 6; round++) {
  globalThis.changing = round * 2;
  reads.push(readChanging(), changing);
  changing = round * 2 + 1;
  reads.push(globalThis.changing);
  storeChanging(-round);
  reads.push(globalThis.changing);
}
console.log(reads.join(","));

Object.defineProperty(globalThis, "changing", { writable: false });
storeChanging("ignored");
console.log(globalThis.changing, readChanging());

const received = [];
Object.defineProperty(globalThis, "changing", { get() { return "getter"; }, set(value) { received.push(value); }, configurable: true });
storeChanging("received");
console.log(readChanging(), changing, received.join());

delete globalThis.changing;
console.log(attempt(readChanging));
storeChanging("created again");
console.log(globalThis.changing, readChanging());
