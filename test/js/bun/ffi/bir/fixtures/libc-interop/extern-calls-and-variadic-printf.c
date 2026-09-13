int printf(const char *fmt, ...);
int puts(const char *s);
unsigned long strlen(const char *s);
void *memcpy(void *d, const void *s, unsigned long n);
void *memset(void *d, int c, unsigned long n);
int abs(int);
double sqrt(double);
/* atoi returns an int; declared like this, the bits above the low byte are whatever the
   library left there, as the ABI allows for a narrow result. */
signed char atoi(const char *);
int lens(void) { char buf[16]; memset(buf, 'x', 15); buf[15] = 0; memcpy(buf, "abc", 3); return (int)strlen(buf) * 10 + (int)strlen("four") + abs(-3) * 1000 + (buf[2] == 'c') + (buf[3] == 'x'); }
double root(double d) { return sqrt(d) + sqrt(16); }
int narrow_ret(const char *digits) { return atoi(digits); }
int print(void) {
    float f = 1.5f; char c = 'Z'; short s = -7; unsigned char u = 200; long big = 1234567890123L; unsigned un = 4000000000u;
    int n = printf("%d %s %.2f %c %d %d %ld %u %x%%\n", 42, "str", f, c, s, u, big, un, 255);
    puts("done");
    return n;
}

int main(void) {
  printf("%d\n", lens());
  printf("%.17g\n", root(81.0));
  printf("%d\n", narrow_ret("133"));
  printf("%d\n", print());
  return 0;
}
