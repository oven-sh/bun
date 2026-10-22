// Every reference to Node_ stands inside the class: in a static field, a static block and a method. The code outside reaches it through a closure that the static block stores.
let make: (() => { depth(): number }) | undefined;

class Node_ {
  static root = new Node_(undefined);
  static {
    make = () => new Node_(new Node_(Node_.root));
  }
  constructor(public parent: Node_ | undefined) {}
  depth(): number {
    return this.parent instanceof Node_ ? this.parent.depth() + 1 : 0;
  }
}

console.log(make!().depth());
