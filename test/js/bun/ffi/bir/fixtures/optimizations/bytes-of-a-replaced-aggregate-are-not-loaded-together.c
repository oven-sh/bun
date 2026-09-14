void *memcpy(void *, const void *, unsigned long);
         int format(const unsigned char *data) { unsigned char params[4]; memcpy(params, data, sizeof(params)); return params[2] | (params[1] << 8); }

int printf(const char *, ...);
static void bun_test_fill(unsigned char *to, const unsigned char *from, int n) {
  for (int i = 0; i < n; i++) to[i] = from[i];
}
static void bun_test_dump(const char *name, const unsigned char *p, int n) {
  printf("%s:", name);
  for (int i = 0; i < n; i++) printf(" %02x", p[i]);
  printf("\n");
}
static unsigned char buffer1[8] __attribute__((aligned(16)));
int main(void) {
  bun_test_fill(buffer1, (const unsigned char[]){1, 2, 3, 4, 0, 0, 0, 0}, 8);
  printf("%d\n", (int)format((void *)buffer1));
  return 0;
}
