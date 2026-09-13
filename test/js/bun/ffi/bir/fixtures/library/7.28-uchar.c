// C11 7.28 <uchar.h>: char16_t and char32_t and the conversions between them and multibyte characters.
// (Apple's C library has no such header.)
#include <limits.h>
#include <stdio.h>
#include <string.h>
#include <uchar.h>

int main(void) {
  printf("%d %d\n", _Generic(u'a', char16_t: 1, default: 0), _Generic(U'a', char32_t: 1, default: 0));
  printf("%d %d\n", (int)sizeof(char16_t) >= 2, (int)sizeof(char32_t) >= 4);
  // In the "C" locale the conversions are defined for the basic characters at least.
  mbstate_t state;
  memset(&state, 0, sizeof state);
  char bytes[MB_LEN_MAX > 8 ? MB_LEN_MAX : 8];
  size_t written = c32rtomb(bytes, U'A', &state);
  char32_t back = 0;
  memset(&state, 0, sizeof state);
  size_t read = mbrtoc32(&back, "B", 1, &state);
  char16_t narrow = 0;
  memset(&state, 0, sizeof state);
  size_t read16 = mbrtoc16(&narrow, "C", 1, &state);
  printf("%d %c %d %c %d %c\n", (int)written, bytes[0], (int)read, (int)back, (int)read16, (int)narrow);
  return 0;
}
