// C11 6.2.7: which types are compatible, and the composite type two declarations of one thing make.
#include <stdio.h>

// Array of unknown size + array of known size: the composite has the size.
extern int table[];
extern int table[4];
// Function without a prototype + one with: the composite has the prototype; parameter lists merge elementwise.
int old_and_new();
int old_and_new(int, double);
int takes_array(int (*)[], int n);
int takes_array(int (*row)[3], int n);
// Qualifiers on parameters are not part of the function's type; array and function parameters are adjusted.
int adjusted(const int value, int row[10], int callback(int));
int adjusted(int value, int *row, int (*callback)(int));

// Structures declared in one translation unit are compatible only with themselves, even with the same members.
struct first { int a; };
struct second { int a; };
typedef struct first also_first;

// Enumerations are compatible with an integer type; two of them need not be with each other.
enum small { SMALL = 1 };

int table[4] = {1, 2, 3, 4};
int old_and_new(int a, double b) { return a + (int)b; }
int takes_array(int (*row)[3], int n) { return (*row)[n]; }
static int add_one(int x) { return x + 1; }
int adjusted(int value, int *row, int (*callback)(int)) { return callback(value) + row[0]; }

#define SAME(a, b) _Generic((a *)0, b *: 1, default: 0)
typedef int three_ints[3], four_ints[4], function_of_int(int), function_of_const_int(const int), *pointer, *const const_pointer;

int main(void) {
  printf("%d %d\n", (int)(sizeof table / sizeof table[0]), old_and_new(1, 2.5));
  int row[3] = {7, 8, 9};
  printf("%d %d\n", takes_array(&row, 2), adjusted(4, row, add_one));
  printf("%d %d %d %d\n", SAME(struct first, also_first), SAME(struct first, struct second), SAME(int, signed int), SAME(int, long)); /* long: any width */
  printf("%d %d %d\n", SAME(three_ints, three_ints), SAME(three_ints, four_ints), SAME(function_of_int, function_of_const_int));
  printf("%d %d %d\n", SAME(const int, int), SAME(pointer, const_pointer), SAME(unsigned char, char));
  // A pointer to an array of unknown size is compatible with a pointer to one of any size.
  int (*unknown)[] = &row;
  int (*known)[3] = unknown;
  printf("%d\n", (*known)[1]);
  // In a conditional expression the result has the composite type of its two pointer operands.
  int (*first_function)() = (int (*)())old_and_new;
  int (*second_function)(int, double) = old_and_new;
  printf("%d\n", (1 ? second_function : first_function)(3, 4.0));
  printf("%d\n", (int)sizeof(*(0 ? known : unknown)) == (int)sizeof row);
  return 0;
}
