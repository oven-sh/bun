// C11 6.5.3 to 6.5.16: every operator, on every arithmetic type it takes, against the result computed in the
// widest type and converted (which is what the conversions of 6.3 say each must equal).
#include <stdint.h>
#include <stdio.h>

static int checks, wrong;
// Every check says what it checked and whether it held; the test compares that, line by line, with values.json.
#define CHECK(c) do { int holds = (c) ? 1 : 0; checks++; wrong += !holds; printf("%s => %d\n", #c, holds); } while (0)

// What an operand of type T becomes before an operator sees it.
#define PROMOTED(T) __typeof__(+(T)0)

#define INTEGER_TYPE(T, a_value, b_value) \
  do { \
    volatile T a = (T)(a_value), b = (T)(b_value); \
    typedef PROMOTED(T) P; \
    const P pa = a, pb = b; \
    const long long wa = (long long)pa, wb = (long long)pb; \
    const int is_signed = (P)-1 < (P)0; \
    (void)is_signed; \
    CHECK((P)(a + b) == (P)((unsigned long long)wa + (unsigned long long)wb)); \
    CHECK((P)(a - b) == (P)((unsigned long long)wa - (unsigned long long)wb)); \
    CHECK((P)(a * b) == (P)((unsigned long long)wa * (unsigned long long)wb)); \
    CHECK((P)(a / b) == (is_signed ? (P)(wa / wb) : (P)((unsigned long long)pa / (unsigned long long)pb))); \
    CHECK((P)(a % b) == (is_signed ? (P)(wa % wb) : (P)((unsigned long long)pa % (unsigned long long)pb))); \
    CHECK((a / b) * b + a % b == a); \
    CHECK((P)(a & b) == (P)(wa & wb) && (P)(a | b) == (P)(wa | wb) && (P)(a ^ b) == (P)(wa ^ wb) && (P)(~a) == (P)(~wa)); \
    CHECK((P)(a << 3) == (P)((unsigned long long)wa << 3) || (is_signed && pa < 0)); \
    CHECK((P)(b >> 2) == (is_signed ? (P)(wb >> 2) : (P)((unsigned long long)pb >> 2))); \
    CHECK((P)(-a) == (P)(0 - (unsigned long long)wa) && +a == pa && (!a) == (pa == 0)); \
    CHECK((a < b) == (is_signed ? wa < wb : (unsigned long long)pa < (unsigned long long)pb)); \
    CHECK((a > b) == !(a <= b) && (a >= b) == !(a < b) && (a == b) == !(a != b)); \
    CHECK((a && b) == (pa != 0 && pb != 0) && (a || b) == (pa != 0 || pb != 0)); \
    CHECK((a ? b : a) == (pa ? pb : pa)); \
    T c = a; \
    c += b; CHECK(c == (T)(a + b)); \
    c = a; c -= b; CHECK(c == (T)(a - b)); \
    c = a; c *= b; CHECK(c == (T)(a * b)); \
    c = a; c /= b; CHECK(c == (T)(a / b)); \
    c = a; c %= b; CHECK(c == (T)(a % b)); \
    c = a; c &= b; CHECK(c == (T)(a & b)); \
    c = a; c |= b; CHECK(c == (T)(a | b)); \
    c = a; c ^= b; CHECK(c == (T)(a ^ b)); \
    c = b; c >>= 1; CHECK(c == (T)(b >> 1)); \
    c = (T)1; c <<= 2; CHECK(c == (T)4); \
    c = a; CHECK(c++ == a && c == (T)(a + 1)); \
    c = a; CHECK(c-- == a && c == (T)(a - 1)); \
    c = a; CHECK(++c == (T)(a + 1) && (--c == a || (T)2 == (T)1)); \
    CHECK((c = b) == b && c == b); \
    CHECK((T)(c = (T)300) == (T)300); \
    CHECK(((void)0, a) == a); \
    CHECK(sizeof(a + b) == sizeof(P) && sizeof(-a) == sizeof(P) && sizeof(a) == sizeof(T)); \
  } while (0)

#define FLOATING_TYPE(T, a_value, b_value) \
  do { \
    volatile T a = (T)(a_value), b = (T)(b_value); \
    CHECK(a + b == (T)((long double)a + (long double)b)); \
    CHECK(a - b == (T)((long double)a - (long double)b)); \
    CHECK(a * b == (T)((long double)a * (long double)b)); \
    CHECK(a / b == (T)((long double)a / (long double)b) || sizeof(T) == sizeof(long double)); \
    CHECK(-a == 0 - a && +a == a && (!a) == (a == 0)); \
    CHECK((a < b) == ((long double)a < (long double)b) && (a > b) == !(a <= b) && (a == b) == !(a != b)); \
    CHECK((a && b) == 1 && (a || 0) == 1 && (a ? 1 : 2) == 1); \
    T c = a; \
    c += b; CHECK(c == (T)(a + b)); \
    c = a; c -= b; CHECK(c == (T)(a - b)); \
    c = a; c *= b; CHECK(c == (T)(a * b)); \
    c = a; c /= b; CHECK(c == (T)(a / b)); \
    c = a; CHECK(c++ == a && c == (T)(a + 1) && --c == a); \
    CHECK((T)(int)a == (T)(long long)a && (int)(T)7 == 7); \
    CHECK(sizeof(a + b) == sizeof(T) && sizeof(a + 1) == sizeof(T)); \
  } while (0)

int main(void) {
  INTEGER_TYPE(_Bool, 1, 1);
  INTEGER_TYPE(char, 100, 7);
  INTEGER_TYPE(signed char, -100, 7);
  INTEGER_TYPE(unsigned char, 200, 9);
  INTEGER_TYPE(short, -30000, 123);
  INTEGER_TYPE(unsigned short, 60000, 321);
  INTEGER_TYPE(int, -2000000000, 12345);
  INTEGER_TYPE(unsigned int, 4000000000u, 54321);
  INTEGER_TYPE(long, -2000000000L, 9999);
  INTEGER_TYPE(unsigned long, 4000000000UL, 8888);
  INTEGER_TYPE(long long, -9000000000000000000LL, 1234567);
  INTEGER_TYPE(unsigned long long, 18000000000000000000ULL, 7654321);
  INTEGER_TYPE(int, 7, -2);
  INTEGER_TYPE(long long, -7, 2);
  FLOATING_TYPE(float, 1.5f, 0.25f);
  FLOATING_TYPE(double, -1234.5678, 3.0);
  FLOATING_TYPE(long double, 123456.75L, -7.0L);
  // Signed division truncates toward zero, and the remainder has the sign of the dividend.
  CHECK(7 / 2 == 3 && -7 / 2 == -3 && 7 / -2 == -3 && -7 / -2 == 3);
  CHECK(7 % 2 == 1 && -7 % 2 == -1 && 7 % -2 == 1 && -7 % -2 == -1);
  // A right shift of a negative value is arithmetic (implementation-defined; as GCC and Clang have it).
  CHECK(-8 >> 1 == -4 && -1 >> 31 == -1 && (-8LL >> 2) == -2);
  // Mixed operands follow the usual arithmetic conversions.
  CHECK(1 / 2 == 0 && 1 / 2.0 == 0.5 && 1.0f / 2 == 0.5f && 7 / 2 * 2.0 == 6.0 && 'a' + 1 == 98);
  CHECK(-1 / 2u == 2147483647u && (unsigned char)250 + (unsigned char)10 == 260 && (unsigned char)(250 + 10) == 4);
  printf("%d checks, %d wrong\n", checks, wrong);
  return wrong != 0;
}
