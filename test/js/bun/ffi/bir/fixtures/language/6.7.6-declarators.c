// C11 6.7.6 and 6.7.7: pointer, array and function declarators in every nesting, and the type names made by
// leaving the identifier out.
#include <stdio.h>

static int seven(void) { return 7; }
static int add(int a, int b) { return a + b; }
static int (*pick(int which))(int, int) { return which ? add : 0; }                 // a function returning a pointer to a function
static int (*(*pick_picker(void))(int))(int, int) { return pick; }                  // ...returning a pointer to that
static int grid[2][3] = {{1, 2, 3}, {4, 5, 6}};
static int (*row_of(int r))[3] { return &grid[r]; }                                 // a function returning a pointer to an array
static int (*table[2])(void) = {seven, seven};                                      // an array of pointers to functions
static int (*(*pointer_to_table)[2])(void) = &table;                                // a pointer to that array
static int *pointers[3];                                                            // an array of pointers
static int (*pointer_to_array)[3] = &grid[1];                                       // a pointer to an array
static int **pointer_to_pointer = pointers;
static const char *const *const very_const = (const char *const[]){"a", "b"};
static int (*signal_like(int number, int (*handler)(void)))(void) { (void)number; return handler; }
typedef int binary(int, int);                                                       // a function type
typedef binary *binary_pointer;
static binary *through_typedef = add;
static binary add_prototype;                                                        // declares a function through the typedef
static int add_prototype(int a, int b) { return a - b; }

// Parameters: names optional in a prototype, arrays and functions adjusted to pointers, void alone means none,
// qualifiers and static inside array brackets, an ellipsis after at least one.
static int unnamed(int, char *, double (*)(double));
static int unnamed(int a, char *b, double (*c)(double)) { return a + (b != 0) + (c != 0); }
static int takes_array(int a[], int b[3], int c[static 2], int d[const 1], int e[][2]) { return a[0] + b[1] + c[1] + d[0] + e[1][0]; }
static int takes_function(int f(void), int (*g)(void)) { return f() + g(); }
static int nothing(void) { return 0; }
static int variadic(int count, ...) { return count; }

int main(void) {
  int value = 5;
  pointers[1] = &value;
  printf("%d %d %d %d\n", pick(1)(2, 3), pick_picker()(1)(4, 5), (*row_of(1))[2], (*pointer_to_table)[1]());
  printf("%d %d %d %s\n", (*pointer_to_array)[0], *pointer_to_pointer[1], **(pointer_to_pointer + 1), very_const[1]);
  printf("%d %d %d\n", signal_like(2, seven)(), through_typedef(1, 2), add_prototype(9, 4));
  binary_pointer typed = add;
  int both[2][2] = {{1, 2}, {3, 4}};
  printf("%d %d %d %d %d\n", typed(10, 20), unnamed(1, "x", 0), takes_array(grid[0], grid[0], grid[1], &value, both), takes_function(seven, seven), nothing());
  // Type names: the same declarators without the identifier, in casts, sizeof, compound literals and _Generic.
  printf("%d %d %d\n", (int)sizeof(int *[3]) == 3 * (int)sizeof(int *), (int)sizeof(int (*)[3]) == (int)sizeof(void *), (int)(sizeof(int[2][3]) / sizeof(int)));
  printf("%d %d\n", ((int (*)(int, int))add)(1, 1), (*(int (*(*)(int))(int, int))pick)(1)(2, 2));
  printf("%d %d\n", _Generic(pick, int (*(*)(int))(int, int): 1, default: 0), _Generic(row_of, int (*(*)(int))[3]: 1, default: 0));
  printf("%d\n", _Generic(&table, int (*(*)[2])(void): 1, default: 0));
  // Several declarators share the specifiers but not each other's stars and brackets.
  int plain, *pointer = &value, array[2] = {8, 9}, (*function)(void) = seven, **deep = &pointer;
  plain = *pointer + array[1] + function() + **deep;
  printf("%d\n", plain);
  printf("%d\n", variadic(2, 1.5, "two"));
  return 0;
}
