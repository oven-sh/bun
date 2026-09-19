static int seen; static void bump(int *p) { seen = *p; *p = -1; }
         int value(int n) { return ({ int __attribute__((cleanup(bump))) v = n; int vla[n]; vla[0] = 1; v + vla[0]; }) * 1000 + seen; }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)value(5));
  return 0;
}
