// An attribute list may stand ahead of any declarator of a declaration, and is that declarator's alone:
// `int a, __attribute__((aligned(64))) b;` aligns b and not a. At file scope, in a block, with the C23 spelling's GNU
// name, and next to the other place an attribute can stand, after the declarator.
#include <stdint.h>
#include <stdio.h>

typedef int four_ints __attribute__((vector_size(16)));

int plain, __attribute__((aligned(64))) aligned_to_64, after __attribute__((aligned(32))), also_plain;
static char first_byte, __attribute__((aligned(16))) second_byte, third_byte;
int one_int, __attribute__((vector_size(16))) a_vector;
int weak_one(void), __attribute__((weak)) weak_two(void);
int weak_two(void) { return 2; }
int weak_one(void) { return 1; }

int main(void) {
  int a, __attribute__((aligned(32))) b, c __attribute__((aligned(16))), d;
  a = b = c = d = 0;
  printf("%d %d %d %d\n", (int)__alignof__(plain), (int)__alignof__(aligned_to_64), (int)__alignof__(after), (int)__alignof__(also_plain));
  printf("%d %d %d\n", (int)((uintptr_t)&aligned_to_64 % 64), (int)((uintptr_t)&after % 32), (int)((uintptr_t)&second_byte % 16));
  printf("%d %d %d\n", (int)__alignof__(first_byte), (int)__alignof__(second_byte), (int)__alignof__(third_byte));
  printf("%d %d %d %d\n", (int)__alignof__(a), (int)__alignof__(b), (int)__alignof__(c), (int)__alignof__(d));
  printf("%d %d\n", (int)((uintptr_t)&b % 32), (int)((uintptr_t)&c % 16));
  printf("%d %d\n", (int)sizeof one_int, (int)sizeof a_vector);
  a_vector = (four_ints){ 1, 2, 3, 4 };
  printf("%d %d %d\n", a_vector[3] + a + d, weak_one(), weak_two());
  return 0;
}
