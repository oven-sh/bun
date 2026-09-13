struct message { int length; char text[]; };
         struct message hello = { 5, "hello" };
         struct message listed = { 3, { 'a', 'b', 'c', 0 } };
         static struct message designated = { .text = { [3] = 'x' }, .length = 4 };
         struct numbers { char count; long long values[]; } numbers = { 2, { 10, 20 } };
         struct zero { int n; int tail[0]; };
         union either { int whole; char bytes[]; };
         struct only { int items[]; };
         int after = 77;
         int sizes(void) { return sizeof(struct message) * 1000 + sizeof hello * 100 + sizeof(struct zero) * 10 + sizeof(union either); }
         int read(void) { return hello.text[4] + listed.text[2] + designated.text[3] + designated.length + (int)numbers.values[1] + after; }
         int local_static(void) { static struct message m = { 1, "xy" }; return m.text[1] + m.length; }
         int through_zero(struct zero *z) { return z->tail[1]; }

int printf(const char *, ...);
static void bun_test_fill(unsigned char *to, const unsigned char *from, int n) {
  for (int i = 0; i < n; i++) to[i] = from[i];
}
static void bun_test_dump(const char *name, const unsigned char *p, int n) {
  printf("%s:", name);
  for (int i = 0; i < n; i++) printf(" %02x", p[i]);
  printf("\n");
}
static unsigned char buffer1[16] __attribute__((aligned(16)));
int main(void) {
  printf("%d\n", (int)sizes());
  printf("%d\n", (int)read());
  printf("%d\n", (int)local_static());
  bun_test_fill(buffer1, (const unsigned char[]){0, 0, 0, 0, 0, 0, 0, 0, 9, 0, 0, 0, 0, 0, 0, 0}, 16);
  printf("%d\n", (int)through_zero((void *)buffer1));
  return 0;
}
