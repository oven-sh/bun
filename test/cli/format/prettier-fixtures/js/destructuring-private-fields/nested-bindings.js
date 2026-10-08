class C {
  #x = 1;
  m() {
    const {x: { #x: [x] }, y: [...{ #x: y }]} = this;
  }
}
