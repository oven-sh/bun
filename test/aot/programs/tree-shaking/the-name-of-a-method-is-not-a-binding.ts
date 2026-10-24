// Inside a method, a getter or a field named `load`, the name `load` means the function of the module: only a named function expression binds its own name.
function load(): string {
  return "the function of the module";
}
function size(): number {
  return 3;
}
function make(): string {
  return "made by the module";
}
function own(): string {
  return "never called";
}

const literal = {
  load() {
    return "method of a literal, " + load();
  },
  get size() {
    return size() + 1;
  },
  own: function own(depth: number): string {
    return depth === 0 ? "a function expression calls itself" : own(depth - 1);
  },
};

class Klass {
  load() {
    return "method of a class, " + load();
  }
  make = make();
  static size() {
    return size() + 2;
  }
}

console.log(literal.load(), literal.size, literal.own(1));
console.log(new Klass().load(), new Klass().make, Klass.size());
