function *f() {
  (yield a => a);
  (yield async a => a);
  (yield async (a) => a);
}
