void *memcpy(void *, const void *, __SIZE_TYPE__);
         unsigned pattern(void) { const unsigned char b[4] = { 0, 1, 2, 3 }; unsigned p; memcpy(&p, &b, 4); return p; }
         int tag(unsigned fourcc) { char t[4]; memcpy(t, &fourcc, sizeof t); return t[0] + t[3] * 256; }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)pattern());
  printf("%d\n", (int)tag(1094861636));
  return 0;
}
