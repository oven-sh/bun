// Replacing a property value on a prototype object: every derived object sees the new value at once, whatever was cached before.
const lines = [];
const say = (...parts) => lines.push(parts.join(" "));

function storeCount(object, value) {
  object.count = value;
}
function readCount(object) {
  return object.count;
}
function storeByKey(object, key, value) {
  object[key] = value;
}
function attempt(action) {
  try {
    return action();
  } catch (error) {
    return error.constructor.name;
  }
}

{
  const parent = { count: 0, text: "a" };
  const child = Object.create(parent);
  const grandchild = Object.create(child);
  let sum = 0;
  for (let i = 0; i < 3000; i++) {
    storeCount(parent, i);
    sum += readCount(child) + readCount(grandchild) + readCount(parent);
  }
  say("data", sum, Object.keys(child).length);
  storeCount(child, -1);
  storeCount(parent, 5);
  say("shadowed", readCount(parent), readCount(child), readCount(grandchild), Object.keys(child).join());
  delete child.count;
  say("shadow gone", readCount(child), readCount(grandchild));
  delete parent.count;
  say("deleted", readCount(parent), readCount(child), "count" in grandchild);
  storeCount(parent, 9);
  say("added again", readCount(child), Object.keys(parent).join());
}

{
  const parent = { count: 0 };
  const child = Object.create(parent);
  for (let i = 0; i < 3000; i++) storeCount(parent, i);
  const seen = [];
  Object.defineProperty(parent, "count", {
    get() {
      return 7;
    },
    set(value) {
      seen.push(value);
    },
    configurable: true,
  });
  storeCount(parent, 11);
  storeCount(child, 12);
  say("accessor", readCount(parent), readCount(child), seen.join(), Object.keys(child).length);
  Object.defineProperty(parent, "count", { value: 3, writable: false, configurable: true });
  say("read-only", attempt(() => storeCount(parent, 13)), attempt(() => storeCount(child, 14)), readCount(parent), readCount(child), Object.keys(child).length);
  Object.defineProperty(parent, "count", { value: 4, writable: true });
  storeCount(parent, 17);
  say("writable again", readCount(parent), readCount(child));
}

{
  const parent = { count: 0 };
  const child = Object.create(parent);
  for (let i = 0; i < 3000; i++) storeCount(parent, i);
  Object.freeze(parent);
  say("frozen", attempt(() => storeCount(parent, -5)), attempt(() => storeCount(child, 1)), readCount(parent), readCount(child));
}

{
  function Maker(a) {
    this.a = a;
  }
  const one = function () {
    return 1;
  };
  const two = function () {
    return 2;
  };
  Maker.prototype.size = one;
  Maker.prototype.weight = 10;
  const made = [new Maker(1), new Maker(2), new Maker(3), new Maker(4)];
  const callSize = object => object.size();
  const storeSize = (object, value) => {
    object.size = value;
  };
  let sum = 0;
  for (let i = 0; i < 3000; i++) sum += callSize(made[i & 3]);
  say("method", sum);
  sum = 0;
  for (let i = 0; i < 3000; i++) {
    storeSize(Maker.prototype, i & 1 ? one : two);
    sum += callSize(made[i & 3]);
  }
  say("method replaced in turn", sum);
  storeSize(Maker.prototype, 5);
  say("no function", attempt(() => callSize(made[0])));
  storeSize(Maker.prototype, two);
  storeSize(made[1], one);
  say("own method", callSize(made[0]), callSize(made[1]), callSize(made[2]));
  const other = { size: () => 40 };
  Object.setPrototypeOf(made[2], other);
  storeSize(Maker.prototype, one);
  say("another prototype", callSize(made[0]), callSize(made[2]));
  storeSize(other, () => 41);
  say("its method replaced", callSize(made[2]));
}

{
  class Base {
    static count = 0;
    static make() {
      return "base";
    }
    size() {
      return 1;
    }
  }
  class Heir extends Base {}
  const callMake = it => it.make();
  let sum = 0;
  for (let i = 0; i < 3000; i++) {
    storeCount(Base, i);
    sum += readCount(Heir) + readCount(Base) + callMake(Heir).length;
  }
  say("static", sum, Object.getOwnPropertyNames(Heir).includes("count"));
  storeCount(Heir, -2);
  storeCount(Base, 8);
  say("static shadowed", readCount(Base), readCount(Heir));
  Base.make = () => "another";
  say("static method replaced", callMake(Base), callMake(Heir));
  const storeMake = (it, value) => {
    it.make = value;
  };
  for (let i = 0; i < 3000; i++) storeMake(Base, i & 1 ? () => "odd" : () => "even");
  say("static method replaced in turn", callMake(Base), callMake(Heir));
  const callSize = it => it.size();
  const heir = new Heir();
  for (let i = 0; i < 3000; i++) sum += callSize(heir);
  Base.prototype.size = () => 100;
  say("method of a class replaced", callSize(heir), callSize(new Base()));
}

{
  const mark = Symbol("mark");
  const parent = { count: 0, text: "a", [mark]: 0 };
  const child = Object.create(parent);
  let sum = 0;
  for (let i = 0; i < 3000; i++) {
    storeByKey(parent, i & 1 ? "count" : "text", i);
    storeByKey(parent, mark, i);
    sum += child.count + child.text + child[mark];
  }
  say("by key", sum);
  storeByKey(parent, "more", 1);
  say("added by key", child.more, Object.keys(parent).join());
  Object.defineProperty(parent, "text", {
    set(value) {
      sum = value;
    },
    get() {
      return "got";
    },
  });
  storeByKey(parent, "text", -3);
  say("accessor by key", sum, child.text);
}

{
  globalThis.settings = { limit: 1, name: "s" };
  const heir = Object.create(globalThis.settings);
  const readLimit = () => settings.limit;
  const storeLimit = (object, value) => {
    object.limit = value;
  };
  let sum = 0;
  for (let i = 0; i < 3000; i++) sum += readLimit();
  for (let i = 0; i < 3000; i++) {
    storeLimit(settings, i);
    sum += readLimit() + heir.limit;
  }
  say("a member of a global", sum);
}

{
  const parent = {};
  for (let i = 0; i < 20; i++) parent["p" + i] = i;
  parent.count = 0;
  const child = Object.create(parent);
  let sum = 0;
  for (let i = 0; i < 3000; i++) {
    storeCount(parent, i);
    sum += readCount(child);
  }
  say("out of line", sum);
}

{
  const parent = { count: 0 };
  let sum = 0;
  for (let i = 0; i < 3000; i++) storeCount(parent, i);
  const child = Object.create(parent);
  for (let i = 0; i < 3000; i++) {
    storeCount(parent, i);
    sum += readCount(child);
  }
  say("becomes a prototype when the store is known", sum);
}

console.log(lines.join("\n"));
