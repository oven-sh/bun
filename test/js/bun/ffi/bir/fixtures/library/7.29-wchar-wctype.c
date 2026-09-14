// C11 7.29 <wchar.h> and 7.30 <wctype.h>: wide strings and their functions, wide classification, conversions to
// and from multibyte strings in the "C" locale.
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <wchar.h>
#include <wctype.h>

static int checks, wrong;
#define CHECK(c) do { checks++; if (!(c)) { wrong++; printf("WRONG (line %d): %s\n", __LINE__, #c); } } while (0)

int main(void) {
  wchar_t buffer[32], other[32];
  const wchar_t *text = L"the quick brown fox";
  CHECK(wcslen(text) == 19 && wcslen(L"") == 0);
  CHECK(wcscpy(buffer, L"abc") == buffer && wcscmp(buffer, L"abc") == 0 && wcscmp(L"abc", L"abd") < 0 && wcsncmp(L"abcd", L"abce", 3) == 0);
  CHECK(wcscat(buffer, L"def") == buffer && wcslen(buffer) == 6 && wcsncat(buffer, L"ghijk", 2) == buffer && wcscmp(buffer, L"abcdefgh") == 0);
  CHECK(wcsncpy(other, L"hi", 4) == other && other[2] == 0 && other[3] == 0);
  CHECK(wcschr(text, L'q') == text + 4 && wcsrchr(text, L'o') == text + 17 && wcschr(text, L'z') == 0);
  CHECK(wcsstr(text, L"brown") == text + 10 && wcsspn(text, L"the ") == 4 && wcscspn(text, L"q") == 4 && wcspbrk(text, L"kc") == text + 7);
  CHECK(wmemcpy(other, L"wxyz", 5) == other && wmemcmp(other, L"wxyz", 5) == 0 && wmemchr(other, L'y', 4) == other + 2);
  CHECK(wmemmove(other + 1, other, 3) == other + 1 && wmemcmp(other, L"wwxy", 4) == 0 && wmemset(other, L'-', 3) == other && other[2] == L'-' && other[3] == L'y');
  wchar_t sentence[] = L"a,b;;c", *state, *token = wcstok(sentence, L",;", &state);
  int tokens = 0;
  while (token) { tokens++; token = wcstok(0, L",;", &state); }
  CHECK(tokens == 3);
  wchar_t *end;
  CHECK(wcstol(L"-42rest", &end, 10) == -42 && *end == L'r' && wcstoul(L"ff", 0, 16) == 255 && wcstod(L"2.5", 0) == 2.5 && wcstoll(L"9000000000", 0, 10) == 9000000000LL);
  // Formatted wide output and input.
  CHECK(swprintf(buffer, 32, L"%d %ls %s %lc", 7, L"wide", "narrow", (wint_t)L'!') == 15 && wcscmp(buffer, L"7 wide narrow !") == 0);
  int number = 0; wchar_t word[8];
  CHECK(swscanf(L"12 abc", L"%d %7ls", &number, word) == 2 && number == 12 && wcscmp(word, L"abc") == 0);
  // Multibyte and wide, for the characters every locale has.
  char narrow[16];
  CHECK(mbstowcs(other, "plain", 16) == 5 && wcscmp(other, L"plain") == 0 && wcstombs(narrow, L"back", 16) == 4 && strcmp(narrow, "back") == 0);
  wchar_t one;
  CHECK(mbtowc(&one, "x", 1) == 1 && one == L'x' && wctomb(narrow, L'y') == 1 && narrow[0] == 'y' && mblen("z", 1) == 1);
  CHECK(btowc('a') == L'a' && wctob(L'b') == 'b' && btowc(EOF) == WEOF);
  mbstate_t conversion;
  memset(&conversion, 0, sizeof conversion);
  CHECK(mbsinit(&conversion) && mbrtowc(&one, "q", 1, &conversion) == 1 && one == L'q' && wcrtomb(narrow, L'r', &conversion) == 1 && narrow[0] == 'r');
  // <wctype.h>
  CHECK(iswalpha(L'a') && !iswalpha(L'1') && iswdigit(L'7') && iswspace(L' ') && iswupper(L'Q') && iswlower(L'q') && iswpunct(L'!') && iswxdigit(L'f'));
  CHECK(iswalnum(L'z') && iswprint(L' ') && !iswgraph(L' ') && iswcntrl(L'\n') && iswblank(L'\t') && !iswalpha(WEOF));
  CHECK(towupper(L'a') == L'A' && towlower(L'A') == L'a' && towupper(L'1') == L'1');
  CHECK(iswctype(L'a', wctype("alpha")) && !iswctype(L'a', wctype("digit")) && towctrans(L'a', wctrans("toupper")) == L'A');
  CHECK(sizeof(wint_t) >= sizeof(wchar_t) && WEOF != (wint_t)L'a' && WCHAR_MAX > 0);
  printf("%d checks, %d wrong\n", checks, wrong);
  return wrong != 0;
}
