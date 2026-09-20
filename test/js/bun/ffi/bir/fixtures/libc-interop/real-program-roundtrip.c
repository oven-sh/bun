// Number formatting and parsing round trips: snprintf, strtol, strtoul, PRI macros.
#include <errno.h>
#include <inttypes.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// Formats `value` in `base` (10 or 16), parses it back and returns 1 if it survived.
int roundtrip_long(long value, int base) {
    char buf[40];
    if (base == 16)
        snprintf(buf, sizeof buf, "%s0x%lx", value < 0 ? "-" : "", value < 0 ? 0ul - (unsigned long)value : (unsigned long)value);
    else
        snprintf(buf, sizeof buf, "%ld", value);
    char *end;
    errno = 0;
    long parsed = strtol(buf, &end, 0);
    return errno == 0 && *end == '\0' && parsed == value;
}

int format_u64(uint64_t value, char *out, size_t size) {
    return snprintf(out, size, "%" PRIu64 "/%" PRIx64 "/%" PRId64, value, value, (int64_t)value);
}

// Parses "key=123,other=0x10" and sums the values; returns -1 on malformed input.
long sum_assignments(const char *s) {
    long total = 0;
    while (*s) {
        const char *eq = strchr(s, '=');
        if (!eq) return -1;
        char *end;
        long v = strtol(eq + 1, &end, 0);
        if (end == eq + 1) return -1;
        total += v;
        s = *end == ',' ? end + 1 : end;
        if (*end && *end != ',') return -1;
    }
    return total;
}

int limits_roundtrip(void) {
    return roundtrip_long(LONG_MAX, 10) + roundtrip_long(LONG_MIN + 1, 10) + roundtrip_long(0, 16) + roundtrip_long(-255, 16) + roundtrip_long(INT_MAX, 16);
}

int printf(const char *, ...);
static void bun_test_fill(unsigned char *to, const unsigned char *from, int n) {
  for (int i = 0; i < n; i++) to[i] = from[i];
}
static void bun_test_dump(const char *name, const unsigned char *p, int n) {
  printf("%s:", name);
  for (int i = 0; i < n; i++) printf(" %02x", p[i]);
  printf("\n");
}
static unsigned char buffer1[80] __attribute__((aligned(16)));
static unsigned char buffer2[16] __attribute__((aligned(16)));
static unsigned char buffer3[8] __attribute__((aligned(16)));
int main(void) {
  printf("%d\n", (int)limits_roundtrip());
  printf("%d\n", (int)roundtrip_long(-123456789LL, 10));
  for (int i = 0; i < 80; i++) buffer1[i] = 0;
  printf("%d\n", (int)format_u64(-1LL, (void *)buffer1, 80LL));
  bun_test_dump("buffer1", buffer1, 80);
  bun_test_fill(buffer2, (const unsigned char[]){97, 61, 49, 44, 98, 61, 48, 120, 49, 48, 44, 99, 61, 45, 51, 0}, 16);
  printf("%lld\n", (long long)sum_assignments((void *)buffer2));
  bun_test_fill(buffer3, (const unsigned char[]){97, 61, 44, 0, 0, 0, 0, 0}, 8);
  printf("%lld\n", (long long)sum_assignments((void *)buffer3));
  return 0;
}
