// Exported functions that hot JavaScript calls millions of times, so that the calls are compiled by every tier of
// the JavaScript compiler and, where they are small enough, the C body is compiled into the JavaScript loop itself.
#include <stdint.h>

int add_wrapping(int a, int b) { return (int)((unsigned)a + (unsigned)b); }
unsigned above_two_to_the_31(unsigned a) { return a + 0x80000000u; }
double real_arithmetic(double a, double b) { return a / b - b; }
double passes_through(double a) { return a; }
float single_precision(float a, float b) { return a * b + 0.1f; }
_Bool is_a_multiple(int a, int of) { return of != 0 && a % of == 0; }
int narrows_to_8(signed char a, unsigned char b) { return a * 1000 + b; }
int narrows_to_16(short a, unsigned short b) { return a * 7 + b; }
long long wide_sum(long long a, long long b) { return (long long)((unsigned long long)a + (unsigned long long)b); }
unsigned long long wide_unsigned(unsigned long long a) { return ~a; }
const void *address_of(const unsigned char *bytes, int offset) { return bytes + offset; }
int reads_memory(const int *values, int index) { return values[index]; }
int loop_and_branch(unsigned n) { int steps = 0; while (n != 1 && steps < 200) { n = n % 2 ? 3 * n + 1 : n / 2; steps++; } return steps; }
static long long calls_so_far;
static int last_argument;
long long counts_calls(int argument) { last_argument = argument; return ++calls_so_far; }
int last_seen(void) { return last_argument; }
static int helper(int x) { return x * x - 1; }
int calls_another(int x) { return helper(x & 0xfff) + helper((x >> 3) & 0xff); }
int traps_if_negative(int x) { if (x < 0) __builtin_trap(); return x + 1; }
unsigned too_big_to_inline(unsigned x) {
  x = x * 3u + (x >> 1) + 0u; x ^= x << 1;
  x = x * 5u + (x >> 2) + 427799u; x ^= x << 2;
  x = x * 7u + (x >> 3) + 855598u; x ^= x << 3;
  x = x * 9u + (x >> 4) + 283394u; x ^= x << 4;
  x = x * 11u + (x >> 5) + 711193u; x ^= x << 5;
  x = x * 3u + (x >> 6) + 138989u; x ^= x << 6;
  x = x * 5u + (x >> 7) + 566788u; x ^= x << 7;
  x = x * 7u + (x >> 1) + 994587u; x ^= x << 8;
  x = x * 9u + (x >> 2) + 422383u; x ^= x << 9;
  x = x * 11u + (x >> 3) + 850182u; x ^= x << 10;
  x = x * 3u + (x >> 4) + 277978u; x ^= x << 11;
  x = x * 5u + (x >> 5) + 705777u; x ^= x << 1;
  x = x * 7u + (x >> 6) + 133573u; x ^= x << 2;
  x = x * 9u + (x >> 7) + 561372u; x ^= x << 3;
  x = x * 11u + (x >> 1) + 989171u; x ^= x << 4;
  x = x * 3u + (x >> 2) + 416967u; x ^= x << 5;
  x = x * 5u + (x >> 3) + 844766u; x ^= x << 6;
  x = x * 7u + (x >> 4) + 272562u; x ^= x << 7;
  x = x * 9u + (x >> 5) + 700361u; x ^= x << 8;
  x = x * 11u + (x >> 6) + 128157u; x ^= x << 9;
  x = x * 3u + (x >> 7) + 555956u; x ^= x << 10;
  x = x * 5u + (x >> 1) + 983755u; x ^= x << 11;
  x = x * 7u + (x >> 2) + 411551u; x ^= x << 1;
  x = x * 9u + (x >> 3) + 839350u; x ^= x << 2;
  x = x * 11u + (x >> 4) + 267146u; x ^= x << 3;
  x = x * 3u + (x >> 5) + 694945u; x ^= x << 4;
  x = x * 5u + (x >> 6) + 122741u; x ^= x << 5;
  x = x * 7u + (x >> 7) + 550540u; x ^= x << 6;
  x = x * 9u + (x >> 1) + 978339u; x ^= x << 7;
  x = x * 11u + (x >> 2) + 406135u; x ^= x << 8;
  x = x * 3u + (x >> 3) + 833934u; x ^= x << 9;
  x = x * 5u + (x >> 4) + 261730u; x ^= x << 10;
  x = x * 7u + (x >> 5) + 689529u; x ^= x << 11;
  x = x * 9u + (x >> 6) + 117325u; x ^= x << 1;
  x = x * 11u + (x >> 7) + 545124u; x ^= x << 2;
  x = x * 3u + (x >> 1) + 972923u; x ^= x << 3;
  x = x * 5u + (x >> 2) + 400719u; x ^= x << 4;
  x = x * 7u + (x >> 3) + 828518u; x ^= x << 5;
  x = x * 9u + (x >> 4) + 256314u; x ^= x << 6;
  x = x * 11u + (x >> 5) + 684113u; x ^= x << 7;
  x = x * 3u + (x >> 6) + 111909u; x ^= x << 8;
  x = x * 5u + (x >> 7) + 539708u; x ^= x << 9;
  x = x * 7u + (x >> 1) + 967507u; x ^= x << 10;
  x = x * 9u + (x >> 2) + 395303u; x ^= x << 11;
  x = x * 11u + (x >> 3) + 823102u; x ^= x << 1;
  x = x * 3u + (x >> 4) + 250898u; x ^= x << 2;
  x = x * 5u + (x >> 5) + 678697u; x ^= x << 3;
  x = x * 7u + (x >> 6) + 106493u; x ^= x << 4;
  x = x * 9u + (x >> 7) + 534292u; x ^= x << 5;
  x = x * 11u + (x >> 1) + 962091u; x ^= x << 6;
  x = x * 3u + (x >> 2) + 389887u; x ^= x << 7;
  x = x * 5u + (x >> 3) + 817686u; x ^= x << 8;
  x = x * 7u + (x >> 4) + 245482u; x ^= x << 9;
  x = x * 9u + (x >> 5) + 673281u; x ^= x << 10;
  x = x * 11u + (x >> 6) + 101077u; x ^= x << 11;
  x = x * 3u + (x >> 7) + 528876u; x ^= x << 1;
  x = x * 5u + (x >> 1) + 956675u; x ^= x << 2;
  x = x * 7u + (x >> 2) + 384471u; x ^= x << 3;
  x = x * 9u + (x >> 3) + 812270u; x ^= x << 4;
  x = x * 11u + (x >> 4) + 240066u; x ^= x << 5;
  x = x * 3u + (x >> 5) + 667865u; x ^= x << 6;
  x = x * 5u + (x >> 6) + 95661u; x ^= x << 7;
  x = x * 7u + (x >> 7) + 523460u; x ^= x << 8;
  x = x * 9u + (x >> 1) + 951259u; x ^= x << 9;
  x = x * 11u + (x >> 2) + 379055u; x ^= x << 10;
  x = x * 3u + (x >> 3) + 806854u; x ^= x << 11;
  x = x * 5u + (x >> 4) + 234650u; x ^= x << 1;
  x = x * 7u + (x >> 5) + 662449u; x ^= x << 2;
  x = x * 9u + (x >> 6) + 90245u; x ^= x << 3;
  x = x * 11u + (x >> 7) + 518044u; x ^= x << 4;
  x = x * 3u + (x >> 1) + 945843u; x ^= x << 5;
  x = x * 5u + (x >> 2) + 373639u; x ^= x << 6;
  x = x * 7u + (x >> 3) + 801438u; x ^= x << 7;
  x = x * 9u + (x >> 4) + 229234u; x ^= x << 8;
  x = x * 11u + (x >> 5) + 657033u; x ^= x << 9;
  x = x * 3u + (x >> 6) + 84829u; x ^= x << 10;
  x = x * 5u + (x >> 7) + 512628u; x ^= x << 11;
  x = x * 7u + (x >> 1) + 940427u; x ^= x << 1;
  x = x * 9u + (x >> 2) + 368223u; x ^= x << 2;
  x = x * 11u + (x >> 3) + 796022u; x ^= x << 3;
  return x;
}
