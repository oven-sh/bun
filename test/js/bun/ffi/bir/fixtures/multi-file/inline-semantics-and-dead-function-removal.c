static int unused_static(int x) { return x; }
         static inline int unused_inline(int x) { return unused_static(x); }
         static int used_by_table(int x) { return x + 100; }
         static int used_transitively(int x) { return x * 3; }
         static inline int helper(int x) { return used_transitively(x) + 1; }
         static int (*const table[])(int) = { used_by_table };
         inline int inline_only(int x) { return x + 7; }
         extern inline int extern_inline(int x) { return x + 8; }
         inline int declared_plain(int x) { return x + 9; }
         int declared_plain(int x);
         static int address_taken(int x) { return -x; }
         int run(int x) { int (*f)(int) = address_taken; return helper(x) + table[0](x) + inline_only(x) + f(x); }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)run(2));
  printf("%d\n", (int)extern_inline(1));
  printf("%d\n", (int)declared_plain(1));
  return 0;
}
