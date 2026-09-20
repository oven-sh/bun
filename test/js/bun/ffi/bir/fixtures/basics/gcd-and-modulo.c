int gcd(int a, int b) { while (b) { int t = a % b; a = b; b = t; } return a; }
         unsigned ugcd(unsigned a, unsigned b) { return b ? ugcd(b, a % b) : a; }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)gcd(48, 18));
  printf("%d\n", (int)gcd(17, 5));
  printf("%d\n", (int)ugcd(1071, 462));
  return 0;
}
