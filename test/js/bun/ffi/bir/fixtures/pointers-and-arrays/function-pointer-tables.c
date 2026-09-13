static int add(int a, int b) { return a + b; }
         static int sub(int a, int b) { return a - b; }
         static int mul(int a, int b) { return a * b; }
         typedef int (*binop)(int, int);
         static binop ops[] = { add, sub, &mul };
         static int (*pick(int i))(int, int) { return ops[i]; }
         int apply(int which, int a, int b) { return ops[which](a, b); }
         int apply_deref(int which, int a, int b) { int (*f)(int, int) = ops[which]; return (*f)(a, b) + (**f)(a, b); }
         int apply_pick(int which, int a, int b) { return pick(which)(a, b); }
         int local_table(int a) { int (*t[2])(int, int) = { mul, add }; return t[0](a, a) + t[1](a, 1); }
         int same(void) { binop f = add; return f == add && f != sub && ops[2] == mul; }
         static int twice(binop f, int x) { return f(f(x, x), x); }
         int higher(int x) { return twice(mul, x) + twice(add, x); }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)apply(0, 7, 3));
  printf("%d\n", (int)apply(1, 7, 3));
  printf("%d\n", (int)apply(2, 7, 3));
  printf("%d\n", (int)apply_deref(1, 7, 3));
  printf("%d\n", (int)apply_pick(2, 6, 7));
  printf("%d\n", (int)local_table(5));
  printf("%d\n", (int)same());
  printf("%d\n", (int)higher(3));
  return 0;
}
