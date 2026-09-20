// C23's [[attribute]] syntax, in every position it may stand, for the standard attributes and the vendor ones.
#include <stdio.h>
#include <stdlib.h>

[[nodiscard]] static int must_use(void) { return 1; }
[[deprecated]] static int old(void) { return 2; }
[[deprecated("with a reason")]] static int older(void) { return 3; }
[[maybe_unused]] static int perhaps(void) { return 4; }
[[noreturn]] static void leaves(void) { exit(0); }
[[gnu::always_inline]] static inline int vendor(int x) { return x + 5; }
[[gnu::noinline, gnu::cold]] static int two_in_one(int x) { return x + 6; }
[[gnu::noinline]] [[gnu::hot]] static int two_lists(int x) { return x + 7; }
[[__gnu__::__const__]] static int underscored(int x) { return x + 8; }
[[unknown_vendor::whatever(1, "two", three)]] static int unknown(void) { return 9; }
struct [[gnu::packed]] packed { char c; int i; };
struct [[maybe_unused]] tagged { int a [[maybe_unused]]; [[maybe_unused]] int b; };
enum [[maybe_unused]] color { RED [[maybe_unused]], GREEN [[deprecated]] = 5 };
static int after_declarator [[maybe_unused]] = 10;
[[maybe_unused]] static int before_specifiers = 11;
static int parameters([[maybe_unused]] int unused, int used [[maybe_unused]]) { return used; }
typedef int aligned_int [[gnu::aligned(16)]];

int main(void) {
  [[maybe_unused]] int local = 12;
  int total = 0;
  switch (local) {
    case 12: total += 1; [[fallthrough]];
    case 13: total += 10; break;
    default: total = -1;
  }
  [[maybe_unused]] label: total += 100;
  [[]] ;
  printf("%d %d %d %d %d %d %d %d %d\n", must_use(), old(), older(), perhaps(), vendor(0), two_in_one(0), two_lists(0), underscored(0), unknown());
  printf("%d %d %d %d %d %d %d\n", (int)sizeof(struct packed), RED + GREEN, after_declarator + before_specifiers, parameters(1, 2), (int)_Alignof(aligned_int), total, local);
  if (total < 0) leaves();
  return 0;
}
