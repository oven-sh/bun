#define __attribute__(xyz) /* Ignore */
         typedef int V __attribute__((vector_size(16)));
         struct __attribute__((packed)) P { char c; int i; };
         int f(void) { V v = {1, 2, 3, 4}; v += v; return v[3] * 100 + sizeof(struct P); }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)f());
  return 0;
}
