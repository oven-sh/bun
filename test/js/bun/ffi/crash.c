void crash() {
  volatile char *p = (volatile char *)42;
  p[0] = 123;
}
