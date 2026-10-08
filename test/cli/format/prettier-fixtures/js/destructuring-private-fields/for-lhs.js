class C {
  #x = 1;
  m() {
    let x;
    for ({#x: x} of [this]);
  }
}
