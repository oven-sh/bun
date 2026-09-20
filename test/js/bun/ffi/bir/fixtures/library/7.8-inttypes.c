// C11 7.8 <inttypes.h>: the format macros are string literals that paste with their neighbours, for every exact,
// least, fast, maximum and pointer width; the greatest-width functions.
#include <inttypes.h>
#include <stdio.h>
#include <string.h>

int main(void) {
  char line[256];
  int8_t a = -8; uint8_t b = 200; int16_t c = -1600; uint16_t d = 60000; int32_t e = -2000000000; uint32_t f = 4000000000u;
  int64_t g = -9000000000000000000; uint64_t h = 18000000000000000000u;
  snprintf(line, sizeof line, "%" PRId8 " %" PRIu8 " %" PRIi16 " %" PRIu16 " %" PRId32 " %" PRIu32 " %" PRId64 " %" PRIu64, a, b, c, d, e, f, g, h);
  printf("%s\n", line);
  snprintf(line, sizeof line, "%" PRIx8 " %" PRIX16 " %" PRIo32 " %" PRIx64 " %#" PRIX64, b, d, f, h, h);
  printf("%s\n", line);
  int_least8_t l8 = -1; uint_least16_t l16 = 65535; int_fast32_t f32 = -32; uint_fast64_t f64 = 64; intmax_t m = INTMAX_MIN; uintmax_t um = UINTMAX_MAX;
  intptr_t p = -1; uintptr_t up = (uintptr_t)&line;
  snprintf(line, sizeof line, "%" PRIdLEAST8 " %" PRIuLEAST16 " %" PRIdFAST32 " %" PRIuFAST64 " %" PRIdMAX " %" PRIuMAX " %" PRIdPTR " %d", l8, l16, f32, f64, m, um, p, up != 0);
  printf("%s\n", line);
  // The scan macros, which differ from the print ones where the promoted type differs.
  int8_t s8; uint16_t s16; int32_t s32; uint64_t s64; intmax_t smax;
  int matched = sscanf("-7 65000 -123456 18000000000000000000 -9223372036854775807", "%" SCNd8 " %" SCNu16 " %" SCNd32 " %" SCNu64 " %" SCNdMAX, &s8, &s16, &s32, &s64, &smax);
  printf("%d %d %u %d %d %d\n", matched, s8, (unsigned)s16, (int)s32, s64 == 18000000000000000000u, smax == -INTMAX_MAX);
  // imaxabs, imaxdiv (a structure by value), strtoimax, strtoumax.
  imaxdiv_t q = imaxdiv(INTMAX_MAX, 1000000007);
  char *end;
  printf("%d %d %d\n", imaxabs(-5) == 5, q.quot * 1000000007 + q.rem == INTMAX_MAX, q.rem >= 0 && q.rem < 1000000007);
  uintmax_t parsed = strtoumax("ffffffffffffffff", &end, 16);
  printf("%d %d %s\n", strtoimax("-9223372036854775808", 0, 10) == INTMAX_MIN, parsed == UINTMAX_MAX, *end == 0 ? "to the end" : "?");
  printf("%d\n", strcmp(PRId32, "d") == 0 || strcmp(PRId32, "ld") == 0 || strcmp(PRId32, "I32d") == 0);
  return 0;
}
