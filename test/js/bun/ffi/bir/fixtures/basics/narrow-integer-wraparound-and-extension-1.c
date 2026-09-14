int uchar_wrap(void) { unsigned char c = 255; c++; return c; }
         int uchar_dec(void) { unsigned char c = 0; c--; return c; }
         int schar_wrap(void) { signed char c = 127; c++; return c; }
         int short_wrap(void) { short s = 32767; s += 1; return s; }
         int ushort_wrap(void) { unsigned short s = 65535; ++s; return s; }
         int schar_extend(void) { signed char c = (signed char)0x80; int i = c; return i; }
         int char_extend(void) { char c = (char)200; return c; }
         int promote_add(void) { return (unsigned char)200 + (unsigned char)100; }
         int promote_neg(void) { unsigned char c = 1; return -c; }
         int promote_not(void) { unsigned char c = 0; return ~c; }
         int narrow_assign_value(void) { unsigned char c; int v = (c = 0x1ff); return v; }
         int narrow_compound(void) { unsigned char c = 250; c += 10; c *= 2; return c; }
         int narrow_shift(void) { unsigned char c = 0x81; c <<= 1; return c; }
         int narrow_param(unsigned char a, signed char b, short c) { return a + b + c; }
         short ret_short(int v) { return v; }
         unsigned char ret_uchar(int v) { return v; }
         int store_load(void) { struct { signed char a; unsigned char b; short c; unsigned short d; } s; s.a = -1; s.b = -1; s.c = -2; s.d = -2; return s.a + s.b + s.c + s.d; }
         int trunc64(long long v) { return (int)v + (short)v + (unsigned char)v; }
         long long widen(int s, unsigned u) { return (long long)s + u; }
         int post_value(void) { unsigned char c = 255; int old = c++; return old * 1000 + c; }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)uchar_wrap());
  printf("%d\n", (int)uchar_dec());
  printf("%d\n", (int)schar_wrap());
  printf("%d\n", (int)short_wrap());
  printf("%d\n", (int)ushort_wrap());
  printf("%d\n", (int)schar_extend());
  printf("%d\n", (int)char_extend());
  printf("%d\n", (int)promote_add());
  printf("%d\n", (int)promote_neg());
  printf("%d\n", (int)promote_not());
  printf("%d\n", (int)narrow_assign_value());
  printf("%d\n", (int)narrow_compound());
  printf("%d\n", (int)narrow_shift());
  printf("%d\n", (int)narrow_param(305419777, 2147483647, 98304));
  printf("%d\n", (int)ret_short(98304));
  printf("%d\n", (int)ret_uchar(511));
  printf("%d\n", (int)store_load());
  printf("%d\n", (int)trunc64(4295065729LL));
  printf("%lld\n", (long long)widen(-1, -1));
  printf("%d\n", (int)post_value());
  return 0;
}
