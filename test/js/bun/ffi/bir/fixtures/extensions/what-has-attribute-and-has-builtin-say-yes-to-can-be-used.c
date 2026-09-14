// `__has_attribute(x)` and `__has_builtin(x)` are asked so that the answer can be acted on: headers (gnu-efi, Wine's)
// define EFIAPI as `__attribute__((ms_abi))` where the first says yes. So yes is said only for what is then accepted:
// of the two calling-convention attributes, the one that names the target's own; of the builtins, not the ones that
// are known only to be refused.
#include <stdio.h>

#if defined __has_attribute && defined __has_builtin
#if __has_attribute(ms_abi)
#define MICROSOFTS __attribute__((ms_abi))
#else
#define MICROSOFTS
#endif
#if __has_attribute(__sysv_abi__)
#define SYSTEM_VS __attribute__((__sysv_abi__))
#else
#define SYSTEM_VS
#endif
#if __has_builtin(__builtin_nans)
#define SIGNALLING_IS_NOT_A_NUMBER() (__builtin_nans("") != __builtin_nans(""))
#else
#define SIGNALLING_IS_NOT_A_NUMBER() 1
#endif
#if __has_builtin(__builtin_nansf) && __has_builtin(__builtin_nansl)
#define THE_OTHER_TWO() (__builtin_nansf("") != __builtin_nansf("") && __builtin_nansl("") != __builtin_nansl(""))
#else
#define THE_OTHER_TWO() 1
#endif
#else
#define MICROSOFTS
#define SYSTEM_VS
#define SIGNALLING_IS_NOT_A_NUMBER() 1
#define THE_OTHER_TWO() 1
#endif

static MICROSOFTS int one_way(int a, double b, int c) { return a + (int)(b * 2) + c; }
static SYSTEM_VS int the_other_way(int a, double b, int c) { return a * 100 + (int)(b * 2) * 10 + c; }
typedef int (MICROSOFTS *one_way_type)(int, double, int);
typedef int (SYSTEM_VS *the_other_way_type)(int, double, int);

int main(void) {
  one_way_type first = one_way;
  the_other_way_type second = the_other_way;
  printf("%d %d\n", first(1, 1.5, 2), second(1, 1.5, 2));
  printf("%d %d\n", SIGNALLING_IS_NOT_A_NUMBER(), THE_OTHER_TWO());
  // Here the two calling-convention attributes are never both there, and one always is.
#if defined __BUN_CC__ && __has_attribute(ms_abi) + __has_attribute(sysv_abi) != 1
  printf("one of ms_abi and sysv_abi, not %d\n", __has_attribute(ms_abi) + __has_attribute(sysv_abi));
#endif
  return 0;
}
