int printf(const char *fmt, ...);
           int abs(int);
           int via_pointer(int v) { int (*f)(int) = abs; int (*g)(const char *, ...) = printf; g("%d;%s\n", f(v), "x"); return f(v); }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)via_pointer(-12));
  return 0;
}
