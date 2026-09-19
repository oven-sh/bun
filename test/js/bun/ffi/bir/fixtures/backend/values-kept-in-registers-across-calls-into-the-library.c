// Fourteen integers and twelve doubles alive in one function across calls: into the C library, which calls back
// into C (a comparison function that needs many registers itself), through a pointer to a function that uses every
// register it may, and back. What the platform says a callee preserves must be preserved in both directions: the
// values here afterwards, and the library's own across the comparison function (it sorts a thousand elements right).
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define NOINLINE __attribute__((noinline))
static int checks, wrong;
#define CHECK(c) do { int holds = (c) ? 1 : 0; checks++; wrong += !holds; printf("%s => %d\n", #c, holds); } while (0)

struct item { long long key; double weight; int id; };
static volatile long long sink_integer; static volatile double sink_double;

// A comparison function with more live values than there are caller-saved registers.
static int busy_compare(const void *left, const void *right) {
  const struct item *a = left, *b = right;
  long long i1 = a->key, i2 = b->key, i3 = i1 ^ i2, i4 = i1 + i2, i5 = i1 - i2, i6 = i1 * 3, i7 = i2 * 5, i8 = i3 | 1, i9 = i4 & 0xffff, i10 = i5 / 2, i11 = i6 + i7, i12 = i8 - i9;
  double d1 = a->weight, d2 = b->weight, d3 = d1 + d2, d4 = d1 - d2, d5 = d1 * d2, d6 = d3 * 0.5, d7 = d4 * d4, d8 = d5 + 1, d9 = d6 - d7, d10 = d8 * d9, d11 = d1 * 3, d12 = d2 * 7;
  sink_integer = i3 + i4 + i5 + i6 + i7 + i8 + i9 + i10 + i11 + i12;       // (keeps them all alive to here)
  sink_double = d3 + d4 + d5 + d6 + d7 + d8 + d9 + d10 + d11 + d12;
  if (i1 != i2) return (i1 > i2) - (i1 < i2);
  if (d1 != d2) return (d1 > d2) - (d1 < d2);
  return (a->id > b->id) - (a->id < b->id);
}
static int compare_longs(const void *a, const void *b) { long long x = *(const long long *)a, y = *(const long long *)b; return (x > y) - (x < y); }

// Uses every register a callee may use without saving.
static NOINLINE double clobbers_everything(long long seed) {
  long long a = seed, b = seed * 3, c = seed ^ 0x55, d = seed + 7, e = seed - 9, f = seed * seed, g = seed / 4, h = seed * 8, i = ~seed, j = -seed, k = seed | 0xf0, l = seed & 0x3c;
  double p = (double)seed, q = p * 1.5, r = p - 2.25, s = p / 3, t = p * p, u = sqrt(fabs(p) + 1), v = q + r, w = s * t, x = u - v, y = w + x, z = q * s, n = r * t;
  sink_integer = a + b + c + d + e + f + g + h + i + j + k + l;
  sink_double = p + q + r + s + t + u + v + w + x + y + z + n;
  return (double)(sink_integer % 1000) + sink_double * 0;
}

static NOINLINE int keeps_many_values_alive(long long seed, double real, double (*through_pointer)(long long)) {
  long long i1 = seed + 1, i2 = seed * 2, i3 = seed ^ 3, i4 = seed - 4, i5 = seed * 5, i6 = seed + 6, i7 = seed * 16, i8 = seed | 8, i9 = seed - 9, i10 = seed * 10, i11 = seed + 11, i12 = seed ^ 12, i13 = seed - 13, i14 = seed * 14;
  double d1 = real + 1, d2 = real * 2, d3 = real - 3, d4 = real * 4, d5 = real + 5, d6 = real / 6, d7 = real * 7, d8 = real - 8, d9 = real * 9, d10 = real + 10, d11 = real / 11, d12 = real * 12;
  // The library calls back into C, a thousand times and more.
  static struct item items[1000];
  for (int n = 0; n < 1000; n++) { items[n].key = (n * 7919LL) % 101; items[n].weight = (double)((n * 31) % 17) / 4; items[n].id = n; }
  qsort(items, 1000, sizeof items[0], busy_compare);
  int sorted = 1;
  for (int n = 1; n < 1000; n++) sorted &= busy_compare(&items[n - 1], &items[n]) < 0;
  struct item wanted = items[500];
  struct item *found = bsearch(&wanted, items, 1000, sizeof items[0], busy_compare);
  long long numbers[64];
  for (int n = 0; n < 64; n++) numbers[n] = (n * 37) % 64;
  qsort(numbers, 64, sizeof numbers[0], compare_longs);
  for (int n = 0; n < 64; n++) sorted &= numbers[n] == n;
  // A call through a pointer, to a function that uses everything it may.
  double from_pointer = through_pointer(seed) + clobbers_everything(seed + 1);
  char text[64];
  snprintf(text, sizeof text, "%lld %.2f", seed, real);
  int ok = sorted && found == &items[500] && strlen(text) > 0 && from_pointer == from_pointer;
  ok &= i1 == seed + 1 && i2 == seed * 2 && i3 == (seed ^ 3) && i4 == seed - 4 && i5 == seed * 5 && i6 == seed + 6 && i7 == seed * 16;
  ok &= i8 == (seed | 8) && i9 == seed - 9 && i10 == seed * 10 && i11 == seed + 11 && i12 == (seed ^ 12) && i13 == seed - 13 && i14 == seed * 14;
  ok &= d1 == real + 1 && d2 == real * 2 && d3 == real - 3 && d4 == real * 4 && d5 == real + 5 && d6 == real / 6;
  ok &= d7 == real * 7 && d8 == real - 8 && d9 == real * 9 && d10 == real + 10 && d11 == real / 11 && d12 == real * 12;
  return ok;
}

// The same from a handler the library runs at once: a function given to bsearch that itself sorts.
static int nested_compare(const void *key, const void *element) {
  long long scratch[16];
  for (int n = 0; n < 16; n++) scratch[n] = (15 - n) + *(const long long *)key * 0;
  qsort(scratch, 16, sizeof scratch[0], compare_longs);
  for (int n = 0; n < 16; n++) if (scratch[n] != n) return -2;
  return compare_longs(key, element);
}

int main(void) {
  volatile long long seed = 12345; volatile double real = 6.75;
  CHECK(keeps_many_values_alive(seed, real, clobbers_everything));
  CHECK(keeps_many_values_alive(-seed, -real, clobbers_everything));
  long long sorted[32], key = 17;
  for (int n = 0; n < 32; n++) sorted[n] = n;
  long long *found = bsearch(&key, sorted, 32, sizeof sorted[0], nested_compare);
  CHECK(found == &sorted[17]);
  printf("%d checks, %d wrong\n", checks, wrong);
  return wrong != 0;
}
