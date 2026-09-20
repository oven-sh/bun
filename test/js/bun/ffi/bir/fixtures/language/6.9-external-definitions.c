// C11 6.9: function definitions in the new and the old style, their parameters, tentative object definitions,
// and the forms of main. (This one takes argc and argv.)
#include <stdio.h>
#include <string.h>

// Old-style (K&R) definitions: the arguments arrive promoted and are converted back to the declared types.
static int old_style(a, b, c, d) char a; short b; float c; int *d; { return a + b + (int)(c * 2) + *d; }
static int declared_in_any_order(x, y) int y; int x; { return x * 10 + y; }
static double old_returning_double(x) double x; { return x / 2; }

// A prototype in scope converts the arguments; without one, the default promotions apply.
static long long widens(long long x) { return x * 2; }
static int unprototyped();
static int unprototyped(int a, double b) { return a + (int)b; }

// Parameters are objects of the function's outermost block: modifiable, addressable, distinct per call.
static int modifies_parameter(int n) { int *p = &n; while (*p < 10) n += 3; return n; }
static int array_parameter(int values[4]) { values[0] = 99; return (int)sizeof values == (int)sizeof(int *); }
static int function_parameter(int callback(int)) { return callback(2) + (*callback)(3); }
static int square(int x) { return x * x; }
static void returns_nothing(int *out) { *out = 5; return; }
static int falls_off_the_end_unused(void) { }               // allowed if the caller does not use the value

// Tentative definitions: no initializer, no extern; together they define one zero-initialized object.
int tentative;
int tentative;
static int internal_tentative;
int array_completed_later[];
int array_completed_later[3];
extern int declared_and_defined;
int declared_and_defined = 8;

int main(int argc, char *argv[]) {
  int seven = 7;
  printf("%d %d %.1f\n", old_style('a', 2, 1.5f, &seven), declared_in_any_order(6, 7), old_returning_double(5.0));
  printf("%lld %d\n", widens(1 << 30), unprototyped(1, 2.5));
  int values[4] = {1, 2, 3, 4}, out = 0;
  int adjusted = array_parameter(values);
  printf("%d %d %d %d\n", modifies_parameter(1), adjusted, values[0], function_parameter(square));
  returns_nothing(&out);
  falls_off_the_end_unused();
  printf("%d %d %d %d %d\n", out, tentative, internal_tentative, (int)(sizeof array_completed_later / sizeof(int)), declared_and_defined);
  // argv[0] names the program, argv[argc] is a null pointer, and the strings can be modified.
  printf("%d %d %d\n", argc >= 1, argv[argc] == 0, argv[0] != 0 && strlen(argv[0]) > 0);
  // Reaching the end of main returns 0.
}
