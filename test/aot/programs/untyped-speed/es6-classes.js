// Classes in three levels: `super` calls, a getter, a static factory with `new this`, toString in a template literal, and a tree that is built and walked again and again.
class Node {
  constructor(name) {
    this.name = name;
    this.children = [];
    this.parent = null;
  }
  add(child) {
    child.parent = this;
    this.children.push(child);
    return this;
  }
  get depth() {
    let depth = 0;
    for (let node = this.parent; node; node = node.parent) depth++;
    return depth;
  }
  weight() {
    let total = this.ownWeight();
    for (const child of this.children) total += child.weight();
    return total;
  }
  ownWeight() {
    return 1;
  }
  static of(name) {
    return new this(name);
  }
}

class File extends Node {
  constructor(name, size) {
    super(name);
    this.size = size;
  }
  ownWeight() {
    return this.size;
  }
}

class Link extends File {
  constructor(name, target) {
    super(name, 0);
    this.target = target;
  }
  ownWeight() {
    return super.ownWeight() + (this.target ? 2 : 1);
  }
  toString() {
    return `${this.name} -> ${this.target.name}`;
  }
}

function build(width, levels) {
  const root = Node.of("root");
  let row = [root];
  for (let level = 0; level < levels; level++) {
    const next = [];
    for (const parent of row) {
      for (let i = 0; i < width; i++) {
        const child = i === 0 ? new Node("d" + i) : i === 1 ? new Link("l" + i, parent) : new File("f" + i, i * 3);
        parent.add(child);
        if (i === 0) next.push(child);
      }
    }
    row = next;
  }
  return { root, last: row[0] };
}

function run(rounds) {
  let total = 0;
  for (let i = 0; i < rounds; i++) {
    const { root, last } = build(6, 12);
    total += root.weight() + last.depth + String(root.children[1]).length;
    total += root.children[2] instanceof File ? 1 : 0;
  }
  return total;
}

console.log(run(30000));
