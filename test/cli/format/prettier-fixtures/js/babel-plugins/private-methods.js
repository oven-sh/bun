// https://babeljs.io/docs/babel-plugin-proposal-private-methods

// Test for `classPrivateProperties` and `classPrivateMethods`

class Counter extends HTMLElement {
  #xValue = 0;
  #render() {}

  get #x() { return this.#xValue; }
  set #x(value) {
    this.#xValue = value;
    window.requestAnimationFrame(
      this.#render.bind(this));
  }

  #clicked() {
    this.#x++;
  }
}
