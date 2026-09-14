/* Every operation on __int128, on operands that exercise the carries between the halves. The
   expected output is what gcc prints for the same file. */
#include <stdio.h>
typedef __int128 s128;
typedef unsigned __int128 u128;

static s128 join(unsigned long long lo, long long hi) { return ((s128)hi << 64) | lo; }
static void show(const char *what, s128 v) { printf(" %s=%016llx%016llx", what, (unsigned long long)(v >> 64), (unsigned long long)v); }

static s128 binary(int op, s128 a, s128 b) {
  s128 r = 0;
  u128 ua = a, ub = b;
  int amount = (int)((unsigned long long)b & 127);
  switch (op) {
    case 0: r = a + b; break;
    case 1: r = a - b; break;
    case 2: r = a * b; break;
    case 3: r = b ? a / b : 0; break;
    case 4: r = b ? a % b : 0; break;
    case 5: r = b ? (s128)(ua / ub) : 0; break;
    case 6: r = b ? (s128)(ua % ub) : 0; break;
    case 7: r = a & b; break;
    case 8: r = a | b; break;
    case 9: r = a ^ b; break;
    case 10: r = ~a; break;
    case 11: r = -a; break;
    case 12: r = (s128)(ua << amount); break;
    case 13: r = a >> amount; break;
    case 14: r = (s128)(ua >> amount); break;
    case 15: r = (a < b) | (a <= b) << 1 | (a > b) << 2 | (a >= b) << 3 | (a == b) << 4 | (a != b) << 5
                 | (ua < ub) << 6 | (ua <= ub) << 7 | (ua > ub) << 8 | (ua >= ub) << 9; break;
    case 16: { u128 t = ua; t += ub; t -= 1; t *= 3; t <<= 2; t ^= ub; r = (s128)t; break; }
    case 17: { u128 t = ua; t++; ++t; t--; t = t++ + ub; r = (s128)t; break; }
    case 18: r = a ? b : (s128)-ub; break;
    case 19: r = (!a) + (a && b) * 2 + (a || b) * 4; break;
  }
  return r;
}

static void convert(long long v, unsigned long long u, double d) {
  s128 from_signed = v;
  u128 from_unsigned = u;
  s128 from_double = (s128)d;
  u128 from_small = (unsigned char)v;
  s128 from_bool = (_Bool)v;
  show("signed", from_signed); show("unsigned", (s128)from_unsigned); show("double", from_double); show("small", (s128)from_small); show("bool", from_bool);
  printf(" %d %d %d %llx\n", (int)(from_signed * 3), (short)from_unsigned, (_Bool)(from_signed << 70), (unsigned long long)((u128)1 << 100 >> 64));
}
static double to_double(s128 v, int is_unsigned) { return is_unsigned ? (double)(u128)v : (double)v; }
static float to_float(s128 v) { return (float)v; }

static s128 global_value = -5;
static u128 global_big = 0xfedcba9876543210ULL;
struct wrapper { char tag; s128 value; };
static struct wrapper wrap(s128 v) { struct wrapper w = { 1, v }; return w; }
static s128 add3(s128 a, int b, u128 c) { return a + b + (s128)c; }
static unsigned long long factorial_high(int n) { u128 f = 1; for (int i = 2; i <= n; i++) f *= (unsigned)i; return (unsigned long long)(f >> 64); }
static unsigned long long mulhi(unsigned long long a, unsigned long long b) { return (unsigned long long)(((u128)a * b) >> 64); }

int main(void) {
  const s128 values[9] = {
    0, 1, -1,
    join(0x0fedcba987654321ULL, 0x123456789abcdef0LL),
    -join(0x0123456789abcdefULL, 0x0123456789abcdefLL),
    join(~0ULL, 0x7fffffffffffffffLL),
    join(1, (long long)0x8000000000000000ULL),
    join(~0ULL, 0),
    join(0, 1),
  };
  for (int i = 0; i < 9; i++)
    for (int j = 0; j < 9; j++) {
      printf("%d %d:", i, j);
      for (int op = 0; op < 20; op++) {
        char name[4];
        snprintf(name, sizeof name, "%d", op);
        show(name, binary(op, values[i], values[j]));
      }
      printf("\n");
    }
  convert(-3, (unsigned long long)-2, -1e30);
  printf("%.17g %.17g %.17g %.9g\n", to_double(join(1, 0x7000000000000000LL), 0), to_double(-1, 1), to_double(-1, 0), (double)to_float(-((s128)1 << 90)));
  s128 (*fp)(s128, int, u128) = add3;
  struct wrapper w = wrap(fp(global_value, 7, global_big));
  show("calls", w.value);
  printf(" %zu %zu %zu\n", sizeof(s128), _Alignof(s128), sizeof(struct wrapper));
  printf("%llx %llx\n", factorial_high(30), mulhi(0xdeadbeefcafef00dULL, 0x123456789abcdef1ULL));
  return 0;
}
