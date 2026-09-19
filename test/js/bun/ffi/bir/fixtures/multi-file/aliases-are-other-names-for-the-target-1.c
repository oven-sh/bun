int calls;
         int target(int x) { calls++; return x + 1; }
         int also_target(int) __attribute__((alias("target")));
         static int hidden(int) __attribute__((alias("target")));
         int by_label(int) __asm__("target");
         int counter = 34;
         extern int counter_alias __attribute__((alias("counter")));
         int labelled __asm__("counter");
         int use(void) { counter_alias += 1; labelled += 1; return also_target(1) + hidden(2) + by_label(3) + counter * 100 + calls * 1000; }
         int same_address(void) { return also_target == target && &counter_alias == &counter; }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)use());
  printf("%d\n", (int)same_address());
  printf("%d\n", (int)also_target(10));
  return 0;
}
