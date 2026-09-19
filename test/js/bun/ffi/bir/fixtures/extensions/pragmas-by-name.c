// Every pragma the compiler gives a meaning to, and that the ones it does not know are skipped.
#include <stddef.h>
#include <stdio.h>

struct natural { char c; int i; };
#pragma pack(push, 1)
struct packed_1 { char c; int i; };
#pragma pack(push, 2)
struct packed_2 { char c; int i; };
#pragma pack(pop)
struct packed_1_again { char c; int i; };
#pragma pack(pop)
struct natural_again { char c; int i; };
#pragma pack(2)
struct by_number { char c; int i; };
#pragma pack()
struct reset { char c; int i; };
#pragma pack(push, named, 1)
struct with_a_name { char c; int i; };
#pragma pack(pop, named)

#define VALUE 1
#pragma push_macro("VALUE")
#undef VALUE
#define VALUE 2
static const int while_pushed = VALUE;
#pragma pop_macro("VALUE")
static const int after_pop = VALUE;

#pragma weak never_defined_anywhere
extern int never_defined_anywhere(void);
#pragma redefine_extname renamed_function its_real_name
int renamed_function(void);
int its_real_name(void) { return 77; }

#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wunused-variable"
#pragma GCC diagnostic pop
#pragma GCC visibility push(default)
#pragma GCC visibility pop
#pragma clang diagnostic push
#pragma clang diagnostic pop
#pragma STDC FP_CONTRACT OFF
#pragma STDC FENV_ACCESS OFF
#pragma STDC CX_LIMITED_RANGE OFF
#pragma omp parallel for
#pragma region a Microsoft one
#pragma endregion
#pragma mark an Apple one
#pragma GCC poison this_identifier_is_never_used_again
#pragma message("said while compiling")
#pragma something nobody has ever heard of

_Pragma("pack(push, 1)") struct through_the_operator { char c; int i; }; _Pragma("pack(pop)")

int main(void) {
  printf("%d %d %d %d %d %d %d %d %d\n", (int)offsetof(struct natural, i), (int)offsetof(struct packed_1, i), (int)offsetof(struct packed_2, i), (int)offsetof(struct packed_1_again, i),
         (int)offsetof(struct natural_again, i), (int)offsetof(struct by_number, i), (int)offsetof(struct reset, i), (int)offsetof(struct with_a_name, i), (int)offsetof(struct through_the_operator, i));
  printf("%d %d\n", while_pushed, after_pop);
  printf("%d %d\n", never_defined_anywhere == 0, renamed_function());
  return 0;
}
