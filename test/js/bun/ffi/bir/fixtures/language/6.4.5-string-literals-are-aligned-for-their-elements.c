// C11 6.4.5p6: a string literal is an array of its element type, so it is aligned for that type wherever it lands among
// the other constants; the library's wide string functions read it a word at a time.
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <wchar.h>

typedef __CHAR16_TYPE__ char16_t;
typedef __CHAR32_TYPE__ char32_t;

static int checks, wrong;
// Every check says what it checked and whether it held; the test compares that, line by line, with values.json.
#define CHECK(c) do { int holds = (c) ? 1 : 0; checks++; wrong += !holds; printf("%s => %d\n", #c, holds); } while (0)

#define ALIGNED(p) ((uintptr_t)(p) % _Alignof(*(p)) == 0)

// Narrow literals of odd lengths in between push everything after them off a word boundary unless it is put back.
const char *narrow_1 = "x";
const wchar_t *wide_at_file_scope = L"hello wide world, this is a long wide string literal";
const char *narrow_2 = "xyz12";
const char16_t *utf16_at_file_scope = u"sixteen bits each";
const char *narrow_3 = "ab";
const char32_t *utf32_at_file_scope = U"thirty-two bits each";
static const wchar_t *const table[] = { L"one", L"three", L"seventeen letters" };
static const struct { char tag; const char32_t *name; } records[] = { { 'a', U"alpha" }, { 'b', U"be" } };
_Alignas(16) static const char aligned_narrow[] = "sixteen";
_Alignas(64) static const char16_t aligned_wide[] = u"sixty-four";

static size_t length16(const char16_t *s) { size_t n = 0; while (s[n]) n++; return n; }
static size_t length32(const char32_t *s) { size_t n = 0; while (s[n]) n++; return n; }

int main(void) {
  CHECK(ALIGNED(wide_at_file_scope) && ALIGNED(utf16_at_file_scope) && ALIGNED(utf32_at_file_scope));
  CHECK(wcslen(wide_at_file_scope) == 52 && length16(utf16_at_file_scope) == 17 && length32(utf32_at_file_scope) == 20);
  CHECK(strlen(narrow_1) == 1 && strlen(narrow_2) == 5 && strlen(narrow_3) == 2);
  // In a function, after narrow literals of odd lengths.
  const char *a = "q";
  const wchar_t *w = L"a wide literal inside a function, long enough for a vector loop";
  const char *b = "qrs";
  const char16_t *u = u"utf-16 inside a function";
  const char32_t *v = U"utf-32 inside a function";
  CHECK(ALIGNED(w) && ALIGNED(u) && ALIGNED(v) && a[0] == 'q' && b[2] == 's');
  CHECK(wcslen(w) == 63 && length16(u) == 24 && length32(v) == 24);
  CHECK(wcscmp(w, L"a wide literal inside a function, long enough for a vector loop") == 0 && wcscmp(w, wide_at_file_scope) < 0);
  CHECK(wcschr(w, L'v') == w + 52 && wmemcmp(w + 2, L"wide", 4) == 0);
  // Through tables of pointers (relocations).
  CHECK(ALIGNED(table[0]) && ALIGNED(table[1]) && ALIGNED(table[2]) && wcslen(table[2]) == 17 && wcslen(table[0]) + wcslen(table[1]) == 8);
  CHECK(ALIGNED(records[0].name) && ALIGNED(records[1].name) && length32(records[0].name) == 5 && length32(records[1].name) == 2);
  // Literals used for their elements, and their sizes.
  CHECK(L"abc"[1] == L'b' && u"abc"[2] == u'c' && U"abc"[3] == 0 && sizeof L"abc" == 4 * sizeof(wchar_t) && sizeof u"abc" == 8 && sizeof U"abc" == 16);
  CHECK(ALIGNED(&L"xy"[0]) && ALIGNED(&u"xy"[1]) && ALIGNED(&U"xy"[2]));
  // An explicit alignment is kept, and an array initialized from a literal is a copy with the array's own alignment.
  CHECK((uintptr_t)aligned_narrow % 16 == 0 && (uintptr_t)aligned_wide % 64 == 0 && strcmp(aligned_narrow, "sixteen") == 0 && length16(aligned_wide) == 10);
  wchar_t copy[] = L"copied";
  char16_t copy16[8] = u"copied";
  CHECK(ALIGNED(copy) && ALIGNED(copy16) && wcslen(copy) == 6 && length16(copy16) == 6 && sizeof copy == 7 * sizeof(wchar_t));
  // Floating constants that instructions cannot hold live among the constants too.
  volatile long double ld = 1.25L;
  volatile double d = 2.5;
  CHECK(ld * 4 == 5.0L && d * 2 == 5.0);
  printf("%d checks, %d wrong\n", checks, wrong);
  return wrong != 0;
}
