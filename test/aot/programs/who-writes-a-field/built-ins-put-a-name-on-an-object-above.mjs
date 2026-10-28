// Some objects of a shape leave a field empty, and a read of it goes on to the objects above them.
// Here a built-in puts the name of that field on an object above, each in its own way.
function report(label, make, name, put) {
  const filled = make(true);
  const empty = make(false);
  const before = typeof filled[name] + " " + typeof empty[name];
  put();
  console.log(label, before, typeof filled[name], typeof empty[name], name in empty, Object.hasOwn(empty, name));
}

{
  const above = { tag: 1 };
  const make = fill => {
    const object = { __proto__: above, a: 1 };
    if (fill) object.stack = 1;
    return object;
  };
  const read = object => typeof object.stack;
  console.log(read(make(true)), read(make(false)));
  report("captureStackTrace", make, "stack", () => Error.captureStackTrace(above));
  console.log(read(make(true)), read(make(false)));
}
{
  const above = { tag: 1 };
  const make = fill => {
    const object = { __proto__: above, a: 1 };
    if (fill) object.length = "own";
    return object;
  };
  const read = object => typeof object.length;
  console.log(read(make(true)), read(make(false)));
  report("push", make, "length", () => Array.prototype.push.call(above, 1));
  console.log(read(make(true)), read(make(false)));
}
{
  const above = { tag: 1 };
  const make = fill => {
    const object = { __proto__: above, a: 1 };
    if (fill) object.late = "own";
    return object;
  };
  const read = object => typeof object.late;
  console.log(read(make(true)), read(make(false)));
  report("Reflect.set", make, "late", () => Reflect.set({}, "late", 1, above));
  console.log(read(make(true)), read(make(false)));
}
{
  const above = { tag: 1 };
  const make = fill => {
    const object = { __proto__: above, a: 1 };
    if (fill) object.late = "own";
    return object;
  };
  const read = object => typeof object.late;
  console.log(read(make(true)), read(make(false)));
  report("a proxy", make, "late", () => {
    new Proxy(above, {}).late = 1;
  });
  console.log(read(make(true)), read(make(false)));
}
{
  class Entry {
    constructor(fill) {
      this.a = 1;
      if (fill) this.late = "own";
    }
  }
  const make = fill => new Entry(fill);
  const read = object => typeof object.late;
  console.log(read(make(true)), read(make(false)));
  report("defineProperties", make, "late", () =>
    Object.defineProperties(Entry.prototype, JSON.parse('{"late":{"value":1,"writable":true}}')),
  );
  console.log(read(make(true)), read(make(false)));
}
{
  class Entry {
    constructor(fill) {
      this.a = 1;
      if (fill) this.late = "own";
    }
  }
  const make = fill => new Entry(fill);
  const read = object => typeof object.late;
  console.log(read(make(true)), read(make(false)));
  report("assign", make, "late", () => Object.assign(Entry.prototype, JSON.parse('{"late":1}')));
  console.log(read(make(true)), read(make(false)));
}
{
  class Entry {
    constructor(fill) {
      this.a = 1;
      if (fill) this.lastIndex = "own";
    }
  }
  const make = fill => new Entry(fill);
  const read = object => typeof object.lastIndex;
  console.log(read(make(true)), read(make(false)));
  report("a replacement", make, "lastIndex", () => {
    Entry.prototype.exec = () => null;
    Entry.prototype.flags = "g";
    RegExp.prototype[Symbol.replace].call(Entry.prototype, "text", "");
  });
  console.log(read(make(true)), read(make(false)));
}
{
  class Entry {
    constructor(fill) {
      this.a = 1;
      if (fill) this.late = "own";
    }
  }
  const make = fill => new Entry(fill);
  const read = object => typeof object.late;
  console.log(read(make(true)), read(make(false)));
  report("a reviver", make, "late", () =>
    JSON.parse("[1]", function () {
      Object.getPrototypeOf(make(false)).late = 1;
    }),
  );
  console.log(read(make(true)), read(make(false)));
}
