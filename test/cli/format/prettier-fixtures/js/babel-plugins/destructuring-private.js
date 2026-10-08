class Foo {
  #x = 1;
  constructor() {
    console.log(this.#x); // => 1
    const { #x: x } = this;
    console.log(x); // => 1
  }
  equals({ #x: otherX }) {
    const { #x: currentX } = this;
    return currentX === otherX;
  }
}
