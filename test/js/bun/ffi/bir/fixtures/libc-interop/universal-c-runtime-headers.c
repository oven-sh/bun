// The Universal C Runtime through its own headers: the secure and the underscore-named functions, wide
// strings, <complex.h>'s structures, inline stdio with varargs forwarded, setjmp, qsort with a callback,
// and an intrinsic from <intrin.h>.
#include <complex.h>
#include <ctype.h>
#include <errno.h>
#include <intrin.h>
#include <malloc.h>
#include <math.h>
#include <setjmp.h>
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>

static jmp_buf escape;
static int compare(const void *a, const void *b) { return *(const int *)a - *(const int *)b; }
static int __cdecl compare_with_context(void *context, const void *a, const void *b) {
  ++*(int *)context;
  return strcmp(*(const char *const *)a, *(const char *const *)b);
}
static int format(char *out, size_t size, const char *pattern, ...) {
  va_list list;
  va_start(list, pattern);
  int n = vsnprintf(out, size, pattern, list);
  va_end(list);
  return n;
}
static void deep(int n) {
  if (n == 0) longjmp(escape, 42);
  deep(n - 1);
}

int main(void) {
  char buffer[64];
  // (One call to a statement wherever a later argument depends on an earlier one: the order is the compiler's.)
  int length = format(buffer, sizeof buffer, "%s-%d-%.2f-%lld-%zu", "ucrt", 7, 2.5, 1234567890123LL, sizeof(size_t));
  printf("%d %s\n", length, buffer);
  length = _snprintf_s(buffer, sizeof buffer, _TRUNCATE, "%05d|%-6s|%x", 42, "ab", 255);
  int second = sprintf_s(buffer + 32, 32, "%c%c", 'o', 'k');
  printf("%d %d [%s] [%s]\n", length, second, buffer, buffer + 32);
  int copied = strcpy_s(buffer, sizeof buffer, "copied");
  int joined = strcat_s(buffer, sizeof buffer, " and joined");
  printf("%d %d %d\n", copied, joined, (int)strnlen(buffer, sizeof buffer));
  printf("%d %d %d\n", _stricmp("Hello", "hELLO"), _strnicmp("abcX", "ABCy", 3), _memicmp("aB", "Ab", 2));
  char *copy = _strdup("duplicate");
  _strupr(copy);
  printf("%s %zu\n", _strrev(copy), _countof(buffer));
  free(copy);
  wchar_t wide[16];
  length = swprintf(wide, 16, L"%ls-%d", L"w\xe9", 5);
  printf("%d %zu %d %x %d\n", length, wcslen(wide), wcscmp(wide, L"w\xe9-5"), (unsigned)wide[1], (int)(wmemchr(wide, L'-', 5) - wide));
  int numbers[6] = {5, -1, 9, 0, 3, -7};
  qsort(numbers, 6, sizeof *numbers, compare);
  const char *words[4] = {"pear", "apple", "fig", "banana"};
  int calls = 0;
  qsort_s(words, 4, sizeof *words, compare_with_context, &calls);
  printf("%d %d %d %s %s %d\n", numbers[0], numbers[2], numbers[5], words[0], words[3], calls > 0);
  _Dcomplex z = _Cbuild(3.0, 4.0);
  printf("%g %g %g %g\n", cabs(z), creal(z), cimag(conj(z)), cabs(_Cmulcr(z, 2.0)));
  printf("%g %g %d %d\n", sqrt(2.0) * sqrt(2.0), fmod(7.5, 2.0), (int)lround(2.5), isnan(nan("")) != 0);
  errno = 0;
  long parsed = strtol("99999999999", NULL, 10);
  printf("%ld %d %lld\n", parsed, errno == ERANGE, strtoll("-99999999999", NULL, 10));
  void *aligned = _aligned_malloc(100, 64);
  printf("%d %zu\n", ((uintptr_t)aligned & 63) == 0, _aligned_msize(aligned, 64, 0) >= 100);
  _aligned_free(aligned);
  int code = setjmp(escape);
  if (code == 0) deep(5);
  unsigned long index = 0;
  int found = _BitScanReverse64(&index, 1ull << 45);
  printf("%d %d %lu %llu\n", code, found, index, (unsigned long long)__popcnt64(0xff00ff00ff00ff00ull));
  FILE *file = NULL;
  int opened = fopen_s(&file, "NUL", "w") == 0 && file != NULL;
  int printed = file ? fprintf(file, "discarded %d", 1) : -1;
  printf("%d %d\n", opened, printed);
  if (file) fclose(file);
  printf("%d %d\n", isalpha('x') != 0 && !isdigit('x') && toupper('x') == 'X', _MSC_VER >= 1900);
  return 0;
}
