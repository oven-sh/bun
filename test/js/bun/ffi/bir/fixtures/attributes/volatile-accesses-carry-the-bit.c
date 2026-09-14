typedef volatile int vint;
         struct device { int id; volatile unsigned status; unsigned ready : 1; unsigned code : 7; };
         vint global_flag;
         int plain_global;
         int through_pointer(int *p) { return *(volatile int *)p + *p; }
         void store_pointer(volatile short *p, short v) { *p = v; p[2] = v; }
         int typedefed(void) { vint local = 3; local++; return local + global_flag; }
         unsigned member(struct device *d) { d->id = 1; d->status |= 4; return d->status; }
         unsigned whole(volatile struct device *d) { d->id = 2; d->code = 5; return d->ready + d->id; }
         int pointer_itself(int *volatile *slot) { return **slot; }
         int not_volatile(struct device *d) { return d->id + plain_global; }
         int wait_for(volatile int *flag) { int spins = 0; while (!*flag) spins++; return spins; }

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
static unsigned char buffer2[16] __attribute__((aligned(16)));
int main(void) {
  bun_test_fill(buffer1, (const unsigned char[]){21, 0, 0, 0, 0, 0, 0, 0}, 8);
  printf("%d\n", (int)through_pointer((void *)buffer1));
  printf("%d\n", (int)typedefed());
  for (int i = 0; i < 16; i++) buffer2[i] = 0;
  printf("%d\n", (int)member((void *)buffer2));
  bun_test_dump("buffer2", buffer2, 16);
  printf("%d\n", (int)whole((void *)buffer2));
  bun_test_dump("buffer2", buffer2, 16);
  return 0;
}
