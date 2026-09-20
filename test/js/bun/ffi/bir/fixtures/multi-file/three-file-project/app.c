#include "shared.h"
int counter = 10;
struct point origin = { 3, 4 };
static int helper(void) { return 1; }
static int private_total;
int is_even(unsigned n) { return n == 0 ? 1 : is_odd(n - 1); }
int run_parity(unsigned n) { return is_even(n) * 10 + is_odd(n) + helper() * 100; }
int run_table(int a, int b) { int r = 0; for (int i = 0; i < 3; i++) r = r * 100 + operations[i](a, b); return r; }
int run_globals(void) {
    private_total += bump() + bump();
    scratch += 5;
    return counter * 1000 + private_total + origin.x * origin.y * 100000 + scratch * 1000000;
}
const char *run_names(int i) { puts("main"); return describe(i); }
const char *own_string(void) { return "from main"; }
