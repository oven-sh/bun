int abs(int);
         static int twice(int x) { return x * 2; }
         static int neg(int x) { return -x; }
         struct Op { const char *name; int (*fn)(int); };
         static struct Op ops[] = { { "twice", twice }, { "neg", &neg }, { "abs", abs } };
         int run(int i, int x) { return ops[i].fn(x) + ops[i].name[0]; }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)run(0, 21));
  printf("%d\n", (int)run(1, 5));
  printf("%d\n", (int)run(2, -9));
  return 0;
}
