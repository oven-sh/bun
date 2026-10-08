class C {
  #x = 1;
  m() {
    const {#x: x1, #x: x2 = x1 } = this;
  }
}
