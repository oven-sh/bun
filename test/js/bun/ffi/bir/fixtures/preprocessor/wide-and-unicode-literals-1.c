#include <stddef.h>
         static const wchar_t hello[] = L"h\u00e9llo";
         static const unsigned short utf16[] = u"a\U0001F600";
         static const unsigned int utf32[] = U"\x41" U"b";
         int wide(void) { const wchar_t *w = L"ab" "c"; return sizeof hello / sizeof hello[0] * 1000 + hello[1] + w[2] + (L'x' == 120) + (sizeof(L'x') == sizeof(wchar_t)) * 400000; }
         int sixteen(void) { return sizeof utf16 / 2 * 100000 + utf16[1] - 0xd800 + (utf16[2] - 0xdc00) * 10 + (int)sizeof(u'x'); }
         int thirtytwo(void) { return utf32[0] + utf32[1] + (int)(sizeof utf32) * 1000 + (U'\U0001F600' == 0x1F600); }
         int utf8(void) { const char *s = u8"\u00e9"; return (unsigned char)s[0] * 1000 + (unsigned char)s[1]; }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)wide());
  printf("%d\n", (int)sixteen());
  printf("%d\n", (int)thirtytwo());
  printf("%d\n", (int)utf8());
  return 0;
}
