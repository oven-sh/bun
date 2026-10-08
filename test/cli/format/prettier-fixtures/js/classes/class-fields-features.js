class Foo {
  static epoch = new CustomDate(0);
  #xValue = 0;
  get #x() { return this.#xValue; }
  set #x(value) {
    this.#xValue = value;
    window.requestAnimationFrame(this.#render.bind(this));
  }
  #clicked() {
    this.#x++;
  }
  #render() {
    this.textContent = this.#x.toString();
  }
}
