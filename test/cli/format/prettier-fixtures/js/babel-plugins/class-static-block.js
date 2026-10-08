class C {
  static #x = 42;
  static y;
  static {
    try {
      this.y = doSomethingWith(this.#x);
    } catch {
      this.y = "unknown";
    }
  }
}
