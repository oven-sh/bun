#include "shared.h"
static int helper(int x) { return x + scratch * 0; }
int add(int a, int b) { return helper(a) + b; }
int sub(int a, int b) { return a - b; }
int mul(int a, int b) { return a * b; }
const char *const names[3] = { "zero", "one", "two" };
const char *describe(int which) { return names[which]; }
