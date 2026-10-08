class C {
  #x = 1;
  m() {
    let x;
    ({ #x: x } = this);
  }
}
