class Base {
  static #secret = 5;
  static open = 6;
  static readByName(): number {
    return Base.#secret;
  }
  static readByThis(): number {
    return this.#secret;
  }
  static readOpen(): number {
    return this.open;
  }
}

function Tagged(Parent: typeof Base) {
  return class extends Parent {
    tag = "tagged";
  };
}

const Made = Tagged(Base);
console.log("the base itself: " + Base.readByName() + " " + Base.readByThis() + " " + Base.readOpen());
console.log("by name through the subclass: " + Made.readByName() + " open " + Made.readOpen());
try {
  console.log("by this through the subclass: " + Made.readByThis());
} catch (error) {
  console.log("by this through the subclass: threw a TypeError: " + (error instanceof TypeError));
}
