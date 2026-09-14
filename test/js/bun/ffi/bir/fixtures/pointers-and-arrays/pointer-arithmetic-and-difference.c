long diff(void) { int a[10]; int *p = &a[2], *q = &a[9]; return q - p; }
         long diff_struct(void) { struct S { int a; double b; } s[5]; return &s[4] - &s[1]; }
         int walk(void) {
             int a[5] = { 10, 20, 30, 40, 50 };
             int *p = a;
             int s = *p++;       /* 10, p -> a[1] */
             s += *++p;          /* 30, p -> a[2] */
             s += p[-1];         /* 20 */
             s += *(p + 2);      /* 50 */
             p += 2; p -= 1;     /* a[3] */
             s += *p--;          /* 40 */
             s += (p == &a[2]) + (p < &a[3]) + (p >= a) + (p != 0);
             return s;
         }
         int compound_deref(void) {
             int a[3] = { 1, 2, 3 };
             int *p = a;
             *p++ += 10;
             *p++ *= 5;
             *p <<= 2;
             return a[0] * 10000 + a[1] * 100 + a[2] + (int)(p - a) * 1000000;
         }
         int void_ptr(void) { char buf[8]; void *v = buf; v = (char *)v + 3; return (int)((char *)v - buf); }

int printf(const char *, ...);
int main(void) {
  printf("%lld\n", (long long)diff());
  printf("%lld\n", (long long)diff_struct());
  printf("%d\n", (int)walk());
  printf("%d\n", (int)compound_deref());
  printf("%d\n", (int)void_ptr());
  return 0;
}
