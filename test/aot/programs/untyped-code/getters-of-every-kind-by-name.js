// Every kind of getter read by name from untyped code: compiled, bound, proxied and host functions, typed array properties, lazy closure properties.
// Only the jsc shell can count. Elsewhere the count is zero.
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const slowReads = () => count("operationAOTGetByIdAndCache");
const lines = [];
const show = (label, value) => lines.push(label + ": " + String(value));

function readRepeatedly(read, receiver) {
  let last;
  for (let i = 0; i < 1000; i++) last = read(receiver);
  return last;
}

function errorOf(action) {
  try {
    return "no error: " + String(action());
  } catch (error) {
    return error.name + ": " + error.message;
  }
}

const readX = o => o.x;
const readByteLength = o => o.byteLength;
const readByteOffset = o => o.byteOffset;
const readLength = o => o.length;
const readName = o => o.name;

class CompiledGetter {
  get x() {
    return 7;
  }
}
const compiled = new CompiledGetter();
const beforeCompiled = slowReads();
show("class getter", readRepeatedly(readX, compiled));
show("class getter stays out of the engine", slowReads() - beforeCompiled <= 10);

const withGetter = get => Object.defineProperty({}, "x", { get });
show("bound getter", readRepeatedly(readX, withGetter(function () { return this.bound; }.bind({ bound: 8 }))));
show("proxied getter", readRepeatedly(readX, withGetter(new Proxy(function () { return 9; }, {}))));
show("host function getter", readRepeatedly(readX, withGetter(Object.prototype.toString)));

const resizable = new ArrayBuffer(8, { maxByteLength: 32 });
const views = {
  Uint8Array: new Uint8Array(new ArrayBuffer(16), 4, 8),
  Float64Array: new Float64Array(new ArrayBuffer(64), 16, 3),
  tracking: new Uint8Array(resizable, 2),
};
const beforeByteLength = slowReads();
show("byteLength of Uint8Array", readRepeatedly(readByteLength, views.Uint8Array));
show("byteLength of Float64Array", readRepeatedly(readByteLength, views.Float64Array));
show("byteLength stays out of the engine", slowReads() - beforeByteLength <= 10);
for (const name of Object.keys(views)) {
  const view = views[name];
  show(name, [readRepeatedly(readByteLength, view), readRepeatedly(readByteOffset, view), readRepeatedly(readLength, view)].join(" "));
}
resizable.resize(16);
show("tracking after growing", [readByteLength(views.tracking), readByteOffset(views.tracking), readLength(views.tracking)].join(" "));
resizable.resize(1);
show("tracking out of bounds", [readByteLength(views.tracking), readByteOffset(views.tracking), readLength(views.tracking)].join(" "));
const detached = new Uint8Array(new ArrayBuffer(8), 4);
detached.buffer.transfer();
show("detached", [readByteLength(detached), readByteOffset(detached), readLength(detached)].join(" "));
show("byteLength of DataView", readByteLength(new DataView(new ArrayBuffer(8), 2)));
show("byteLength of an object inheriting a view", errorOf(() => readByteLength(Object.create(views.Uint8Array))));

function readFreshClosures(create) {
  let lengths = 0;
  const names = new Set();
  for (let i = 0; i < 1000; i++) {
    const first = create(i);
    lengths += readLength(first) + readLength(first);
    names.add(readName(first));
    names.add(readName(first));
    const second = create(i);
    names.add(readName(second));
    lengths += readLength(second);
  }
  return lengths + " " + [...names].join(",");
}
show("closures", readFreshClosures(i => function named(a, b) { return i + a + b; }));
show("arrow functions", readFreshClosures(i => {
  // Plain Bun inlines a const that is used once, and the arrow function would lose its name.
  var arrow = a => i + a;
  return arrow;
}));
show("methods", readFreshClosures(i => ({ method(a, b, c) { return i + a + b + c; } }).method));
show("bound functions", readFreshClosures(i => function target(a, b) { return i + a + b; }.bind(null, i)));
show("getters", readFreshClosures(i => Object.getOwnPropertyDescriptor({ get accessor() { return i; } }, "accessor").get));
show("setters", readFreshClosures(i => Object.getOwnPropertyDescriptor({ set accessor(value) { void (i + value); } }, "accessor").set));

const inherited = function inheritedName(a, b, c) {
  return a + b + c;
};
const derived = Object.create(inherited);
show("name and length through Object.create", readRepeatedly(readName, derived) + " " + readRepeatedly(readLength, derived));
show("name of the prototype function", readName(inherited));
show("own name after reads through Object.create", JSON.stringify(Object.getOwnPropertyDescriptor(inherited, "name")));
delete inherited.name;
show("name after delete", JSON.stringify(readName(inherited)));
const renamed = function original() {};
readName(renamed);
Object.defineProperty(renamed, "name", { value: "replaced" });
show("name after redefinition", readName(renamed));

class EndlessGetter {
  get x() {
    return this.x + 1;
  }
}
const endless = new EndlessGetter();
show("endless getter", (() => {
  try {
    return readX(endless);
  } catch (error) {
    return error instanceof RangeError;
  }
})());

console.log(lines.join("\n"));
