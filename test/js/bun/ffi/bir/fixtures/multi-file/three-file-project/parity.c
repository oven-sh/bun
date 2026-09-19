#include "shared.h"
static int helper(void) { return 2; }
static int private_total = 7;
int is_odd(unsigned n) { return n == 0 ? 0 : is_even(n - 1); }
int bump(void) { counter += helper(); private_total++; scratch++; return private_total; }
binary operations[3] = { add, sub, mul };
const char *own_string_too(void) { puts("parity"); return "from parity"; }
