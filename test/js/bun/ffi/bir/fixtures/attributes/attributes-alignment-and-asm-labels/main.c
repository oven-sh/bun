#include <stdint.h>
         struct __attribute__((packed)) Wire { char tag; int value; short tail; };
         struct Over { char c; } __attribute__((aligned(16)));
         struct Inner { char a; int b __attribute__((packed)); char c __attribute__((aligned(8))); };
         struct [[gnu::packed]] Bracketed { char a; int b; };
         static int aligned_global __attribute__((aligned(64))) = 5;
         static _Alignas(32) char aligned_array[5];
         __attribute__((noinline, unused)) static int helper(int x) __attribute__((const));
         static int helper(int x) { return x + 1; }
         extern int renamed_function(int) __asm__("abs");
         extern int renamed_variable __asm__("counter_elsewhere");
         int (*__attribute__((cdecl)) fp)(int) = 0;
         [[nodiscard]] int layout(void) { return sizeof(struct Wire) + sizeof(struct Over) * 100 + _Alignof(struct Over) * 10000 + sizeof(struct Inner) * 1000000 + sizeof(struct Bracketed) * 100000000; }
         int alignment(void) { __attribute__((aligned(128))) char local[3]; alignas(64) int other = 1; return (int)((uintptr_t)&aligned_global % 64 + (uintptr_t)aligned_array % 32 + (uintptr_t)local % 128 + (uintptr_t)&other % 64) + other; }
         int packed_access(void) { struct Wire w = { 1, 0x01020304, -2 }; struct Wire *p = &w; p->value += 1; return p->value + p->tail + (int)((char *)&p->value - (char *)p); }
         int calls(int x) { renamed_variable = 3; return helper(x) + renamed_function(-x) + renamed_variable; }
         int fallthrough(int x) { switch (x) { case 1: x++; __attribute__((fallthrough)); case 2: x++; [[fallthrough]]; default: x++; } return x; }
         int label_attr(void) { goto done; done: __attribute__((unused)); return 1; }
         enum __attribute__((packed)) E { A __attribute__((deprecated)) = 3, B };
         void __attribute__((noreturn)) never(void);
         static inline __attribute__((always_inline)) int twice(int x) { return 2 * x; }
         int use_twice(int x) { return twice(x) + B; }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)layout());
  printf("%d\n", (int)alignment());
  printf("%d\n", (int)packed_access());
  printf("%d\n", (int)calls(7));
  printf("%d\n", (int)fallthrough(1));
  printf("%d\n", (int)label_attr());
  printf("%d\n", (int)use_twice(4));
  return 0;
}
