// The twin of set-prototype-of-plain-objects.ts without its types. There the literals are born as typed records; here they are plain objects, which is what Object.setPrototypeOf meets in untyped packages: the fast path for a final object in the stub that calls host functions. The same cases, each tried after the pair (prototype, Structure before) has been remembered.
const attempt = function(what, run) {
  try {
    console.log(what + ":", run());
  } catch (error) {
    console.log(what + ":", error.constructor.name);
  }
};
const parent = { greet() {
  return "hello " + this.name;
}, kind: "parent" };
const other = { greet() {
  return "bye " + this.name;
}, kind: "other" };
const make = function(i) {
  return { name: "n" + i, size: i };
};
const adopt = function(o, p) {
  return Object.setPrototypeOf(o, p);
};
let sum = 0;
for (let i = 0;i < 300; i++) {
  const o = make(i);
  const back = adopt(o, parent);
  sum += (back === o ? 1 : 0) + o.greet().length + (Object.getPrototypeOf(o) === parent ? 1 : 0) + (o.kind === "parent" ? 1 : 0) + Object.keys(o).length;
}
console.log(sum);
attempt("another prototype", function() {
  const o = adopt(make(1), other);
  return [o.greet(), o.kind, Object.getPrototypeOf(o) === other].join(" ");
});
attempt("there and back", function() {
  const o = make(2);
  adopt(o, parent);
  adopt(o, other);
  adopt(o, parent);
  return [o.greet(), o.kind].join(" ");
});
attempt("the same prototype twice", function() {
  const o = make(3);
  adopt(o, parent);
  adopt(o, parent);
  return o.greet();
});
attempt("null", function() {
  const o = adopt(make(4), null);
  return [Object.getPrototypeOf(o), o.name, typeof o.greet].join(" ");
});
attempt("not extensible", function() {
  return adopt(Object.preventExtensions(make(5)), parent).greet();
});
attempt("frozen", function() {
  return adopt(Object.freeze(make(6)), parent).greet();
});
attempt("sealed", function() {
  return adopt(Object.seal(make(7)), parent).greet();
});
attempt("not extensible, the prototype it has", function() {
  const o = Object.preventExtensions(make(8));
  return adopt(o, Object.prototype) === o;
});
attempt("a cycle", function() {
  const top = make(9);
  const below = Object.create(top);
  return adopt(top, below).name;
});
attempt("a longer cycle", function() {
  const top = make(10);
  const low = Object.create(Object.create(top));
  return adopt(top, low).name;
});
attempt("itself", function() {
  const o = make(11);
  return adopt(o, o).name;
});
attempt("an object that is a prototype", function() {
  const middle = make(12);
  const heir = Object.create(middle);
  const before = typeof heir.greet;
  adopt(middle, parent);
  return [before, heir.greet(), heir.kind].join(" ");
});
attempt("an heir sees the change after it has read", function() {
  const middle = make(13);
  const heir = Object.create(middle);
  let seen = "";
  for (let i = 0;i < 5; i++)
    seen += String(heir.kind) + ",";
  adopt(middle, other);
  for (let i = 0;i < 5; i++)
    seen += String(heir.kind) + ",";
  return seen;
});
attempt("elements", function() {
  const o = make(14);
  o[0] = "zero";
  o[1] = "one";
  adopt(o, parent);
  return [o[0], o[1], o.greet()].join(" ");
});
attempt("a prototype with an element that is an accessor", function() {
  const log = [];
  const p = {};
  Object.defineProperty(p, "0", { set(v) {
    log.push("set " + v);
  }, get() {
    return "got";
  } });
  for (let i = 0;i < 20; i++)
    adopt(make(i), p);
  const o = adopt(make(15), p);
  o[0] = "x";
  return [log.join(), o[0], Object.keys(o).join()].join(" ");
});
attempt("elements first, then that prototype", function() {
  const log = [];
  const p = {};
  Object.defineProperty(p, "1", { set(v) {
    log.push("set " + v);
  }, get() {
    return "got";
  } });
  const o = make(16);
  o[0] = "zero";
  adopt(o, p);
  o[1] = "y";
  return [log.join(), o[0], o[1]].join(" ");
});
attempt("an array", function() {
  const a = adopt([1, 2, 3], parent);
  return [Array.isArray(a), a.length, a.kind, typeof a.map].join(" ");
});
attempt("a function", function() {
  const f = adopt(function() {}, parent);
  return [typeof f, f.kind, typeof f.call].join(" ");
});
attempt("a proxy", function() {
  const log = [];
  const o = new Proxy(make(17), { setPrototypeOf(target, p) {
    log.push("trap");
    return Reflect.setPrototypeOf(target, p);
  } });
  adopt(o, parent);
  return [log.join(), o.greet()].join(" ");
});
attempt("a proxy that says no", function() {
  return adopt(new Proxy(make(18), { setPrototypeOf() {
    return false;
  } }), parent).name;
});
attempt("a proxy as the prototype", function() {
  const log = [];
  const p = new Proxy(parent, { get(target, key, receiver) {
    log.push(String(key));
    return Reflect.get(target, key, receiver);
  } });
  const o = adopt(make(19), p);
  return [o.kind, log.join()].join(" ");
});
attempt("a number", function() {
  return adopt(5, parent);
});
attempt("a string", function() {
  return adopt("text", parent);
});
attempt("undefined", function() {
  return adopt(undefined, parent);
});
attempt("null as the object", function() {
  return adopt(null, parent);
});
attempt("a prototype that is no object", function() {
  return adopt(make(20), 5);
});
attempt("no prototype given", function() {
  return Object.setPrototypeOf(make(21));
});
attempt("other shapes", function() {
  let out = "";
  for (let i = 0;i < 6; i++) {
    const o = i % 3 === 0 ? { a: i } : i % 3 === 1 ? { b: i, c: i } : {};
    adopt(o, i % 2 ? parent : other);
    out += o.kind + Object.keys(o).join("") + " ";
  }
  return out;
});
attempt("many prototypes", function() {
  const all = [];
  for (let i = 0;i < 40; i++)
    all.push({ id: i });
  let total = 0;
  for (let round = 0;round < 3; round++)
    for (let i = 0;i < 40; i++)
      total += adopt(make(i), all[i]).id;
  return total;
});
attempt("properties added later", function() {
  const o = adopt(make(22), parent);
  o.extra = 1;
  o.more = 2;
  return [Object.keys(o).join(), o.greet()].join(" ");
});
attempt("a dictionary", function() {
  const o = make(23);
  for (let i = 0;i < 80; i++)
    o["k" + i] = i;
  delete o.k3;
  adopt(o, parent);
  return [o.greet(), o.k4, o.k3, Object.keys(o).length].join(" ");
});
const points = [{ x: 1, y: 2 }, { x: 3, y: 4 }];
let typedSum = 0;
for (const p of points)
  typedSum += p.x + p.y;
attempt("a typed object", function() {
  const loose = function(list) {
    return list;
  }(points);
  const p = adopt(loose[0], parent);
  return [p.x, p.y, p.kind, points[0].x + points[0].y, typedSum].join(" ");
});
if (typeof globalThis.gc === "function")
  globalThis.gc();
attempt("after a collection", function() {
  let total = 0;
  for (let i = 0;i < 50; i++)
    total += adopt(make(i), parent).greet().length;
  return total;
});
const byValue = function(f) {
  return f;
}(Object.setPrototypeOf);
attempt("through a value", function() {
  let total = 0;
  for (let i = 0;i < 300; i++) {
    const o = make(i);
    total += (byValue(o, parent) === o ? 1 : 0) + o.greet().length;
  }
  return total;
});
attempt("through a value, not extensible", function() {
  return byValue(Object.preventExtensions(make(30)), parent).greet();
});
attempt("through a value, a cycle", function() {
  const top = make(31);
  return byValue(top, Object.create(top)).name;
});
attempt("through a value, a typed object", function() {
  const loose = function(list) {
    return list;
  }(points);
  const p = byValue(loose[1], other);
  return [p.x, p.y, p.kind].join(" ");
});
attempt("by call", function() {
  return Object.setPrototypeOf.call(null, make(32), parent).greet();
});
attempt("by apply", function() {
  return Reflect.apply(Object.setPrototypeOf, undefined, [make(33), parent]).greet();
});
attempt("a third argument", function() {
  return Object.setPrototypeOf(make(34), parent, 1).greet();
});
attempt("a receiver of its own", function() {
  const holder = { set: Object.setPrototypeOf };
  return holder.set(make(35), other).greet();
});
const kept = [];
for (let i = 0;i < 40; i++)
  kept.push(make(i));
if (typeof globalThis.gc === "function") {
  globalThis.gc();
  globalThis.gc();
}
attempt("objects that have outlived a collection", function() {
  adopt(make(0), parent);
  let total = 0;
  for (const o of kept)
    total += adopt(o, parent).greet().length;
  if (typeof globalThis.gc === "function")
    globalThis.gc();
  for (const o of kept)
    total += o.greet().length + (Object.getPrototypeOf(o) === parent ? 1 : 0);
  return total;
});
