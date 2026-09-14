// The functions `_FORTIFY_SOURCE` turns the C library's into, called by their names: `__builtin___memcpy_chk(d, s, n,
// size)` is memcpy when the object is `size` bytes and that is enough, or its size is not known ((size_t)-1), and the
// library's checking function otherwise. And `__builtin_object_size`, which is where the headers get `size` from.
// (Here are the functions every C library has; the others are in fixtures of their own.)
#include <stdarg.h>
#include <stddef.h>
#include <stdio.h>
#include <string.h>

static int checks, wrong;
#define CHECK(c) do { int holds = (c) ? 1 : 0; checks++; wrong += !holds; printf("%s => %d\n", #c, holds); } while (0)

#define UNKNOWN ((size_t)-1)

struct record { int id; char name[12]; char tail[4]; };
static char at_file_scope[40];

static int formatted(char *to, size_t size, const char *format, ...) {
  va_list ap;
  va_start(ap, format);
  int n = __builtin___vsnprintf_chk(to, size, 0, UNKNOWN, format, ap);
  va_end(ap);
  return n;
}
static int formatted_without_a_limit(char *to, const char *format, ...) {
  va_list ap;
  va_start(ap, format);
  int n = __builtin___vsprintf_chk(to, 0, 64, format, ap);
  va_end(ap);
  return n;
}
static int calls;
static size_t counted(size_t n) { calls++; return n; }
// Apple's headers mark the destinations of their checked functions this way; Clang then hands the function the size its
// caller knows, and a compiler that does not leaves it unknown.
static size_t size_passed_along(char *const to __attribute__((pass_object_size(0)))) { return __builtin_object_size(to, 0); }
#define checked_copy(to, from, n) __builtin___memcpy_chk(to, from, n, __builtin_object_size(to, 0))

int main(void) {
  char buffer[64], other[64];
  struct record record;
  char *volatile holder = buffer; // (what it points to is not the compiler's to know)
  char *unknown = holder;
  volatile size_t sixty_four = 64; // (so that "enough" has to be found out when the program runs)

  // Sizes that are not known.
  CHECK(__builtin___memcpy_chk(buffer, "hello", 6, UNKNOWN) == buffer && strcmp(buffer, "hello") == 0);
  CHECK(__builtin___memmove_chk(buffer + 1, buffer, 6, UNKNOWN) == buffer + 1 && strcmp(buffer, "hhello") == 0);
  CHECK(__builtin___memset_chk(other, 'x', 5, UNKNOWN) == other && memcmp(other, "xxxxx", 5) == 0);
  CHECK(__builtin___strcpy_chk(other, "copied", UNKNOWN) == other && strcmp(other, "copied") == 0);
  CHECK(__builtin___strcat_chk(other, " and more", UNKNOWN) == other && strcmp(other, "copied and more") == 0);
  CHECK(__builtin___strncpy_chk(buffer, "abcdef", 3, UNKNOWN) == buffer && memcmp(buffer, "abcllo", 6) == 0);
  CHECK(__builtin___strncat_chk(other, "!!!", 1, UNKNOWN) == other && strcmp(other, "copied and more!") == 0);
  CHECK(__builtin___sprintf_chk(buffer, 0, UNKNOWN, "%d-%s", 7, "seven") == 7 && strcmp(buffer, "7-seven") == 0);
  CHECK(__builtin___snprintf_chk(buffer, 4, 0, UNKNOWN, "%d", 123456) == 6 && strcmp(buffer, "123") == 0);
  CHECK(formatted(buffer, sizeof buffer, "%s/%c", "va", 'l') == 4 && strcmp(buffer, "va/l") == 0);
  // Sizes that are known and enough, as constants and as values.
  CHECK(__builtin___memcpy_chk(buffer, "sized", 6, 64) == buffer && strcmp(buffer, "sized") == 0);
  CHECK(__builtin___memcpy_chk(buffer, "exact", 6, 6) == buffer && strcmp(buffer, "exact") == 0);
  CHECK(__builtin___memset_chk(buffer, 0, sizeof buffer, sizeof buffer) == buffer && buffer[63] == 0);
  CHECK(__builtin___memmove_chk(buffer, "moved", 6, sixty_four) == buffer && strcmp(buffer, "moved") == 0);
  CHECK(__builtin___strcpy_chk(buffer, "fits", sixty_four) == buffer && strcmp(buffer, "fits") == 0);
  CHECK(__builtin___strcat_chk(buffer, " too", 64) == buffer && strcmp(buffer, "fits too") == 0);
  CHECK(__builtin___strncpy_chk(other, "0123456789", 4, 64) == other && memcmp(other, "0123ed", 6) == 0);
  CHECK(__builtin___sprintf_chk(buffer, 0, 64, "%s", "plain") == 5 && strcmp(buffer, "plain") == 0);
  CHECK(__builtin___snprintf_chk(buffer, 64, 0, 64, "%05d", 42) == 5 && strcmp(buffer, "00042") == 0);
  CHECK(__builtin___snprintf_chk(buffer, 8, 1, sixty_four, "%s", "limit of eight") == 14 && strcmp(buffer, "limit o") == 0);
  CHECK(formatted_without_a_limit(buffer, "%x", 255) == 2 && strcmp(buffer, "ff") == 0);
  // Every argument is evaluated once, the ones the plain function does not take too.
  calls = 0;
  CHECK(__builtin___memcpy_chk(buffer, "count", counted(6), counted(64)) == buffer && calls == 2);
  CHECK(__builtin___memcpy_chk(buffer, "count", counted(6), UNKNOWN) == buffer && calls == 3);
  CHECK(__builtin___printf_chk(0, "%s printed\n", "checked") == 16);
  CHECK(__builtin___fprintf_chk(stdout, 0, "%d to a stream\n", 1) == 14);

  // What is known of an object's size. (Type 0: to the end of the whole object; 1: of the member it is in; 2 and 3:
  // the least it could be, which is 0 when nothing is known.)
  CHECK(__builtin_object_size(buffer, 0) == 64 && __builtin_object_size(buffer, 1) == 64);
  CHECK(__builtin_object_size(buffer + 10, 0) == 54 && __builtin_object_size(&buffer[60], 0) == 4);
  CHECK(__builtin_object_size(at_file_scope, 0) == 40 && __builtin_object_size((void *)&at_file_scope[8], 1) == 32);
  CHECK(__builtin_object_size(record.name, 0) == sizeof record - offsetof(struct record, name));
  CHECK(__builtin_object_size(record.name, 1) == 12 && __builtin_object_size(&record.name[2], 1) == 10);
  CHECK(__builtin_object_size(&record, 0) == sizeof record && __builtin_object_size(&record.id, 1) == sizeof(int));
  CHECK(__builtin_object_size("literal", 0) == 8);
  CHECK(__builtin_object_size(unknown, 0) == UNKNOWN && __builtin_object_size(unknown, 1) == UNKNOWN);
  CHECK(__builtin_object_size(unknown, 2) == 0 && __builtin_object_size(unknown, 3) == 0);
  calls = 0;
  CHECK(__builtin_object_size(buffer + counted(1), 0) != 0 && calls == 0);
  CHECK(size_passed_along(buffer) == 64 || size_passed_along(buffer) == UNKNOWN);
  CHECK(checked_copy(buffer, "as the headers write it", 24) == buffer && checked_copy(unknown + 30, "tail", 5) == buffer + 30 && strcmp(buffer + 30, "tail") == 0 && strcmp(buffer, "as the headers write it") == 0);
#if defined __has_builtin
#if __has_builtin(__builtin___memcpy_chk) && __has_builtin(__builtin___snprintf_chk) && __has_builtin(__builtin___strcat_chk) && __has_builtin(__builtin_object_size)
  CHECK(1);
#else
  CHECK(!"the builtins are announced");
#endif
#else
  CHECK(1);
#endif
  printf("%d checks, %d wrong\n", checks, wrong);
  return wrong != 0;
}
