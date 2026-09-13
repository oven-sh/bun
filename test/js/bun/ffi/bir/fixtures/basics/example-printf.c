// Calls to libc externs, including a variadic one.

int printf(const char *fmt, ...);
int puts(const char *s);
unsigned long strlen(const char *s);
int abs(int);

int greet(const char *name) {
    return printf("hello, %s! (%lu chars)\n", name, strlen(name));
}

int print_table(int n) {
    int printed = 0;
    for (int i = 1; i <= n; i++) {
        float half = i / 2.0f;
        char letter = 'a' + i % 26;
        short neg = -i;
        printed += printf("%2d %5.2f %c %d %u\n", i, half, letter, neg, (unsigned)abs(neg));
    }
    puts("done");
    return printed;
}

long long print_wide(long long v, double d) {
    printf("%lld %f %x\n", v, d, 255);
    return v;
}

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
  bun_test_fill(buffer1, (const unsigned char[]){98, 117, 110, 0, 0, 0, 0, 0}, 8);
  printf("%d\n", (int)greet((void *)buffer1));
  printf("%d\n", (int)print_table(3));
  printf("%lld\n", (long long)print_wide(-5000000000LL, 0x1.4000000000000p+1));
  return 0;
}
