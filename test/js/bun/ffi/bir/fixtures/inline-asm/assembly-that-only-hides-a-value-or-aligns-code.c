unsigned long long hide(unsigned long long acc) { __asm__("" : "+r"(acc)); return acc * 3; }
         int copy(int *in) { int out; __asm__ volatile("" : "=r"(out) : "0"(*in)); return out + 1; }
         int memory(int *p) { __asm__ volatile("" : "+m"(*p) : : "memory"); return *p; }
         int loop(int n) { int total = 0; __asm__(".p2align 6"); __asm__ volatile(".balign 16\n.align 32");
             for (int i = 0; i < n; i++) total += i; return total; }

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
  printf("%lld\n", (long long)hide(14LL));
  bun_test_fill(buffer1, (const unsigned char[]){41, 0, 0, 0, 0, 0, 0, 0}, 8);
  printf("%d\n", (int)copy((void *)buffer1));
  printf("%d\n", (int)memory((void *)buffer1));
  printf("%d\n", (int)loop(5));
  return 0;
}
