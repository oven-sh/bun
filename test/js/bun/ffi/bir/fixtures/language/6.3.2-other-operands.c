// C11 6.3.2: lvalues, arrays and function designators; void; pointers and the null pointer constant.
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>

static int twice(int x) { return 2 * x; }
struct pair { int a, b; };
static struct pair make(void) { return (struct pair){1, 2}; }

#define IS_POINTER_TO_INT(x) _Generic((x), int *: 1, default: 0)
#define IS_ARRAY_OF_3(x) _Generic(&(x), int (*)[3]: 1, default: 0)

int main(void) {
  // An lvalue that is not an operand of sizeof, &, ++, -- or the left of an assignment is converted to its value,
  // without its qualifiers.
  const int constant = 5; volatile int changing = 6;
  printf("%d %d\n", _Generic(constant, int: 1, default: 0), _Generic(changing, int: 1, default: 0));
  // An array becomes a pointer to its first element, except under sizeof, _Alignof and &, and as a string initializer.
  int array[3] = {10, 20, 30};
  char text[] = "abc";
  printf("%d %d %d %d\n", IS_POINTER_TO_INT(array), IS_ARRAY_OF_3(array), (int)sizeof array, (int)sizeof text);
  printf("%d %d %d\n", *array, *(array + 2), 1[array]);
  printf("%d %d\n", (void *)array == (void *)&array, (void *)(array + 1) == (void *)(&array + 1));
  int matrix[2][3] = {{1, 2, 3}, {4, 5, 6}};
  int (*row)[3] = matrix;
  printf("%d %d %d\n", (*(row + 1))[2], **matrix, (int)sizeof *matrix);
  // A function designator becomes a pointer to the function, except under sizeof and &; so all of these call it.
  int (*pointer)(int) = twice;
  printf("%d %d %d %d %d\n", twice(1), (*twice)(2), (&twice)(3), (****pointer)(4), pointer == &twice);
  // A non-lvalue structure's member can be read; the (void) of an expression is evaluated for its side effects.
  int counted = 0;
  (void)counted++;
  (void)make();
  printf("%d %d\n", make().b, counted);
  // Pointers: to void and back unchanged; an integer constant 0 or (void *)0 is a null pointer constant, and the
  // null pointer compares unequal to every object and function.
  void *opaque = array;
  int *back = opaque;
  const int *more_qualified = array;
  char *null_from_zero = 0, *null_from_void = (void *)0, *null_from_macro = NULL;
  int (*null_function)(int) = 0;
  printf("%d %d %d %d\n", back == array, *more_qualified, null_from_zero == null_from_void, null_from_macro == 0);
  printf("%d %d %d %d\n", null_function == 0, (void *)array != 0, pointer != 0, !null_from_zero);
  printf("%d %d\n", (0 ? array : 0) == 0, (1 ? (void *)0 : array) == 0);
  // A pointer survives a round trip through uintptr_t, and through a pointer to a character type, which
  // walks the bytes of the object.
  uintptr_t as_integer = (uintptr_t)&array[1];
  printf("%d\n", *(int *)as_integer);
  unsigned char *bytes = (unsigned char *)&array[0];
  int rebuilt = 0;
  for (size_t i = 0; i < sizeof(int); i++) ((unsigned char *)&rebuilt)[i] = bytes[i];
  printf("%d %d\n", rebuilt, (int *)(bytes + sizeof(int)) == &array[1]);
  // A pointer to a function of one type, converted to another and back, calls the same function.
  void (*erased)(void) = (void (*)(void))twice;
  printf("%d\n", ((int (*)(int))erased)(21));
  return 0;
}
