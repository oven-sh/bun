class Box<T> {
  x = 1;
  y: T;
  constructor(y: T) {
    this.y = y;
  }
  sum(): string {
    return this.x + ":" + this.y;
  }
}

const NumberBox = Box<number>;

class Derived extends NumberBox {
  extra = "d";
}

const made = new Derived(2);
console.log("keys: " + Object.keys(made).join(" "));
console.log("json: " + JSON.stringify(made));
console.log("members: " + made.x + " " + made.y + " " + made.extra + " " + made.sum());
console.log("kinds: " + typeof made.x + " " + typeof made.y + " " + typeof made.extra);
console.log("instance: " + (made instanceof Derived) + " " + (made instanceof Box));
