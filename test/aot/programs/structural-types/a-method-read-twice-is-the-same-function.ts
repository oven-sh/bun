class Greeter {
  name = "g";
  greet(): string {
    return "hello " + this.name;
  }
  static make(): Greeter {
    return new Greeter();
  }
  get handler(): () => string {
    return this.greet;
  }
}

class Loud extends Greeter {
  shout(): string {
    return super.greet().toUpperCase();
  }
  parentGreet(): () => string {
    return super.greet;
  }
}

interface Greets {
  greet(): string;
}

function take(g: Greets): () => string {
  return g.greet;
}

const a = new Greeter();
const b = new Greeter();
const loud = new Loud();

console.log("read twice: " + (a.greet === a.greet));
console.log("two instances: " + (a.greet === b.greet));
console.log("the prototype's: " + (a.greet === Greeter.prototype.greet));
console.log("inherited: " + (loud.greet === Greeter.prototype.greet) + " " + (loud.greet === a.greet));
console.log("through super: " + (loud.parentGreet() === a.greet));
console.log("through a getter: " + (a.handler === a.greet) + " " + (a.handler === b.handler));
console.log("through a function: " + (take(a) === take(b)) + " " + (take(a) === a.greet) + " " + (take(loud) === take(a)));
console.log("a static method: " + (Greeter.make === Greeter.make) + " " + (Loud.make === Greeter.make));
console.log("Object.is: " + Object.is(a.greet, b.greet));

const kept = a.greet;
console.log("kept in a variable: " + (kept === a.greet) + " " + (kept === take(b)));

const set = new Set([a.greet, b.greet, Greeter.prototype.greet, take(loud)]);
console.log("in a set: " + set.size + " " + set.has(a.greet));

const notes = new WeakMap<object, string>();
notes.set(a.greet, "noted");
console.log("as a weak key: " + notes.get(b.greet) + " " + notes.get(Greeter.prototype.greet));

Object.assign(a.greet, { mark: 1 });
console.log("a member put on it: " + Reflect.get(b.greet, "mark") + " " + Reflect.get(Greeter.prototype.greet, "mark") + " " + Object.keys(take(loud)).join());

const listeners: (() => string)[] = [];
listeners.push(a.greet);
listeners.push(loud.shout);
console.log("found again in a list: " + listeners.indexOf(b.greet) + " " + listeners.indexOf(loud.shout) + " " + listeners.includes(take(a)));
listeners.splice(listeners.indexOf(a.greet), 1);
console.log("removed: " + listeners.length);

console.log("name and length: " + a.greet.name + " " + a.greet.length + " " + Greeter.make.name);
console.log("bound ones differ: " + (a.greet.bind(a) === a.greet.bind(a)));

const literal = {
  name: "literal",
  greet(): string {
    return "hi " + this.name;
  },
  arrow: (): string => "arrow",
};
console.log("a literal's method: " + (literal.greet === literal.greet) + " " + (take(literal) === literal.greet) + " " + (literal.arrow === literal.arrow));

function makeLiteral(): Greets {
  return {
    greet() {
      return "made";
    },
  };
}
console.log("two literals from one function: " + (makeLiteral().greet === makeLiteral().greet));

function declared(): number {
  return 1;
}
const alias = declared;
console.log("a declared function: " + (declared === alias) + " " + [declared].includes(alias));

let same = 0;
for (let i = 0; i < 2000; i++) if (take(a) === take(i % 2 === 0 ? a : b)) same++;
console.log("2000 times: " + same);

const before = a.greet;
Greeter.prototype.greet = function () {
  return "patched";
};
console.log("after it is replaced: " + (a.greet === before) + " " + (a.greet === b.greet) + " " + (take(a) === Greeter.prototype.greet) + " " + before.call(a));

export {};
