// C11 6.4.5: string literals, their prefixes, their types and what adjacent ones make together.
#include <stdio.h>
#include <string.h>
#include <uchar.h>
#include <wchar.h>

#define ELEMENT(x) _Generic((x), char *: "char", wchar_t *: "wchar_t", char16_t *: "char16_t", char32_t *: "char32_t", default: "other")

int main(void) {
  // A string literal is an array of its characters plus a terminating zero, with static storage duration.
  printf("%d %d %d\n", (int)sizeof "abc", (int)sizeof "", (int)sizeof "a\0b");
  printf("%s %s %s %s %s\n", ELEMENT("a"), ELEMENT(u8"a"), ELEMENT(L"a"), ELEMENT(u"a"), ELEMENT(U"a"));
  printf("%d %d %d\n", (int)(sizeof L"ab" / sizeof(wchar_t)), (int)(sizeof u"ab" / sizeof(char16_t)), (int)(sizeof U"ab" / sizeof(char32_t)));
  // Adjacent literals are one; a prefix on any of them is the prefix of the whole.
  printf("%s %d %d\n", "one " "two" " three", (int)sizeof("ab" "cd"), (int)(sizeof(L"ab" "cd") / sizeof(wchar_t)));
  printf("%d %d\n", (int)(sizeof("ab" u"cd") / sizeof(char16_t)), (int)(sizeof(U"ab" "c") / sizeof(char32_t)));
  // Universal character names and escapes in each kind.
  const char16_t *utf16 = u"€\U0001F600";
  const char32_t *utf32 = U"€\U0001F600";
  const unsigned char *utf8 = (const unsigned char *)u8"é";
  printf("%04x %04x %04x %d | %x %x | %02x %02x\n", utf16[0], utf16[1], utf16[2], utf16[3], (unsigned)utf32[0], (unsigned)utf32[1], utf8[0], utf8[1]);
  printf("%d %d\n", L"\x41\102"[1] == L'B', u"\0x"[1] == u'x');
  // The same literal may or may not be the same object; its elements must not be written, but it can be read as
  // any array can.
  const char *p = "hello";
  printf("%c %c %d %d\n", p[1], "hello"[4], (int)strlen(p + 2), "abc" == 0);
  // A character array can be initialized by one, with or without room for the zero.
  char exact[3] = "abc", roomy[8] = "abc", sized[] = "abc";
  wchar_t wide[] = L"wide";
  printf("%d %c %d %d %d\n", (int)sizeof exact, exact[2], roomy[7], (int)sizeof sized, (int)(sizeof wide / sizeof wide[0]));
  // __func__ behaves as a static const char array.
  printf("%s\n", __func__);
  return 0;
}
