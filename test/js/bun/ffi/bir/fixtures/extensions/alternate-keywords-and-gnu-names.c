// Every alternate spelling of a keyword that GNU C has, and the names GNU C predeclares.
#include <stdio.h>

__extension__ typedef unsigned long long wide;
static __inline int twice(int x) { return 2 * x; }
static __inline__ int thrice(int x) { return 3 * x; }
static int copy(int n, int *__restrict to, const int *__restrict__ from) { while (n--) *to++ = *from++; return 0; }
static __const int fixed = 5;
static __const__ int also_fixed = 6;
static __volatile int watched = 7;
static __volatile__ int also_watched = 8;
static __signed char narrow = -1;
static __signed__ int plain = -2;
static __thread int per_thread = 9;
static _Alignas(16) char aligned[4];
_Static_assert(__alignof__(int) == _Alignof(int) && __alignof(int) == _Alignof(int), "three spellings of one operator");
static int named_for_the_linker __asm__("another_name_entirely") = 11;
static int with_attribute __attribute((unused)) = 12;
static __int128_t big = -1;
static __uint128_t ubig = 1;

static int local_labels(int n) {
  __label__ again, done;                                       // labels of this block only
  int total = 0;
again:
  if (n == 0) goto done;
  total += n--;
  goto again;
done:
  return total;
}

int main(void) {
  __typeof__(fixed) a = 1; __typeof(watched) b = 2; typeof(a) c = 3; int d = 4;
  d += 1;
  __auto_type inferred = 2.5f;
  __complex__ double z = 1.0;
  __real__ z = 3.0; __imag__ z = -4.0;
  int from[3] = {1, 2, 3}, to[3];
  copy(3, to, from);
  __asm__ __volatile__("" ::: "memory");
  __asm volatile("");
  asm("");
  printf("%d %d %d %d %d %d %d %d\n", twice(1), thrice(1), to[2], fixed + also_fixed, watched + also_watched, narrow + plain, per_thread, (int)sizeof aligned);
  printf("%d %d %d %d %g %g %g\n", a, b + 0, c, d, (double)inferred, __real__ z, __imag z);
  printf("%d %d %d %d %d\n", named_for_the_linker, with_attribute, (int)(big + 2), (int)ubig, local_labels(4));
  printf("%s %s %s %d\n", __func__, __FUNCTION__, __PRETTY_FUNCTION__[0] == 'i' || __PRETTY_FUNCTION__[0] == 'm' ? "pretty" : "?", (int)sizeof(__builtin_va_list) > 0);
  wide w = __extension__ 0xffffffffffffffffULL;
  printf("%d %d\n", w == (wide)-1, __extension__ ({ int inner = 5; inner * 2; }));
  return 0;
}
