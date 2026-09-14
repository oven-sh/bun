// 6.7.10 with 5.1.1.2p6: the message of `_Static_assert` is a string literal, and adjacent string literals are one
// before anything looks at them. So is every other string a declaration takes: an assembler name, the target of an
// alias, a processor feature.
#include <assert.h>
#include <stdio.h>

#define TEXT(x) #x
#define SIZE_IS(type, size) _Static_assert(sizeof(type) == size, #type " has another size than " TEXT(size))
#define STRING_OF(x) TEXT(x)

_Static_assert(1, "a" "b");
_Static_assert(1, "one" " " "two" " " "three");
_Static_assert(1, u8"with a prefix" " and without");
_Static_assert(1, L"wide");
_Static_assert(1, "narrow" L" and wide");
_Static_assert(sizeof(int) == 4, "int is " STRING_OF(__SIZEOF_INT__) " bytes");
SIZE_IS(char, 1);
SIZE_IS(short, 2);
static_assert(1, "spelled" " the other way");

struct holder {
  int member;
  _Static_assert(1, "among" " members");
  SIZE_IS(long long, 8);
};

int seven(void) __asm__("the_" "seventh");
int seven(void) { return 7; }
int plain_seven(void) { return 7; }
extern int also_seven(void) __attribute__((alias("plain" "_" "seven")));

int main(void) {
  _Static_assert(1, "in " "a block");
  SIZE_IS(struct holder, 4);
  printf("%d %d\n", seven(), also_seven());
#if defined __x86_64__
  printf("%d\n", __builtin_cpu_supports("sse" "2") != 0);
#else
  printf("1\n");
#endif
  return 0;
}
