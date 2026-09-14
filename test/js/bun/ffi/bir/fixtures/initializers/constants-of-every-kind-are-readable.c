// Constants live apart from what the program writes: string literals, const objects of every shape, tables whose
// elements are addresses of other constants, of writable objects and of functions (filled in when the program is
// loaded), and const objects local to a function. All of them read back, and what sits next to them can be written.
// (The constants end at a multiple of 16384 bytes, so that no page holds both kinds; that padding is not in the module,
// which is 1,080 bytes for this program on x86-64 Linux and was 17 KB when it was.)
#include <stdio.h>
#include <string.h>

static int one(void) { return 1; }
static int two(void) { return 2; }
static int writable_target = 5;
static const int constant_target = 6;

const int plain = 42;
static const double real = 2.5;
static const char text[] = "an array of const char";
static const char *const names[] = {"alpha", "beta", "gamma"};           // constant pointers to constants
static const char *movable = "the pointer is writable, the characters are not";
static char *const fixed_pointer_to_writable = (char[]){"writable characters behind a constant pointer"};
static const struct entry { const char *name; int (*call)(void); const int *constant; int *writable; } table[] = {
  {"one", one, &constant_target, &writable_target},
  {"two", two, &plain, &writable_target},
};
static const int matrix[2][3] = {{1, 2, 3}, {4, 5, 6}};
static const struct { char tag; long long wide; double values[2]; } mixed = {'m', 1LL << 40, {0.5, 1.5}};
static const long double extended = 1.25L;
static int counter;
static char buffer[32] = "initialized and writable";
static int zero_filled[1000];

int main(void) {
  static const int local_table[4] = {10, 20, 30, 40};
  static const char *const local_names[] = {"x", "y"};
  const char *literal = "a literal", *same = "a literal";
  printf("%d %.1f %s %s %s %s\n", plain, real, text, names[0], names[2], movable);
  printf("%s %d %s %d %d %d\n", table[0].name, table[0].call() + table[1].call(), table[1].name, *table[0].constant, *table[1].constant, *table[0].writable);
  printf("%d %c %lld %.1f %.2Lf %d %s %s\n", matrix[1][2], mixed.tag, mixed.wide, mixed.values[1], extended, local_table[3], local_names[1], __func__);
  printf("%d %d\n", (int)strlen(literal), strcmp(literal, same) == 0);
  // The writable neighbours are writable, however the two kinds were laid out.
  movable = names[1];
  fixed_pointer_to_writable[0] = 'W';
  *table[1].writable += 1;
  counter++; buffer[0] = 'I'; zero_filled[999] = 9;
  printf("%s %s %d %d %s %d\n", movable, fixed_pointer_to_writable, writable_target, counter, buffer, zero_filled[999] + zero_filled[0]);
  return 0;
}
