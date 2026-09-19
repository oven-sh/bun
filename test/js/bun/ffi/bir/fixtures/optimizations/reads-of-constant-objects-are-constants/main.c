typedef unsigned long long u64;
         static const unsigned char rhotates[5][5] = { { 0, 1, 62, 28, 27 }, { 36, 44, 6, 55, 20 }, { 3, 10, 43 } };
         static u64 rol(u64 v, int n) { return n == 0 ? v : (v << n) | (v >> (64 - n)); }
         u64 keccak(u64 a) { return rol(a, rhotates[1][1]) ^ rol(a, rhotates[0][0]) ^ rol(a, rhotates[2][4]); }
         static const unsigned crc_table[4] = { 0, 0x77073096, 0xee0e612c, 0x990951ba };
         unsigned crc(unsigned c) { return crc_table[2] ^ (c >> 8) ^ crc_table[3]; }
         static const struct config { int width; double scale; const char *name; struct { short lo, hi; } range; int (*handler)(int); } settings
             = { 640, 1.5, "screen", { -2, 7 }, 0 };
         static const int limit = 5; static const float ratio = 0.25f; static const _Bool on = 1; static const signed char negative = -3;
         double scalars(void) { return settings.width * settings.scale + settings.range.lo + settings.range.hi + limit + ratio + on + negative; }
         static const char *const names[] = { "zero", "one", "two" }; static const int numbers[3] = { 7, 8, 9 }; static const int *const third = &numbers[2];
         const char *name(void) { return names[1]; } const int *address(void) { return third; } int through(void) { return *third; }
         int literal(void) { return "abc"[1] + "xyz"[0]; } const char *text(void) { return settings.name; } void *nothing(void) { return (void *)settings.handler; }

         static int mutable_table[2] = { 1, 2 }; static const volatile int hardware = 3; extern const int elsewhere; const int tentative;
         static const int later[2]; const int weak_value __attribute__((weak)) = 4; static struct { const int fixed; int loose; } mixed = { 5, 6 };
         int not_folded(int i) { return mutable_table[1] + hardware + elsewhere + tentative + weak_value + mixed.fixed + crc_table[i] + later[0]; }
         static const int later[2] = { 11, 12 };
         void poke(void) { *(int *)&limit = 6; }

int printf(const char *, ...);
int main(void) {
  printf("%lld\n", (long long)keccak(81985529216486895LL));
  printf("%d\n", (int)crc(4660));
  printf("%.17g\n", (double)scalars());
  printf("%d\n", (int)literal());
  printf("%d\n", (int)through());
  printf("%d\n", (int)not_folded(1));
  printf("%lld\n", (long long)nothing());
  return 0;
}
