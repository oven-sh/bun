extern double my_atof(const char *);
         extern __inline __attribute__((__gnu_inline__)) double my_atof(const char *s) { return s[0] - '0'; }
         extern double my_atof(const char *);
         __inline __attribute__((__gnu_inline__)) int emitted(int x) { return x + 1; }
         char second[] = { "ab"[1], "xy" "z"[2], 0 };
         int use(void) { return (int)my_atof("7") + emitted(1) + second[0] + second[1]; }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)use());
  return 0;
}
