// 6.7.2.2: inside the braces of an enumeration an enumerator has the type its value got it (GCC and Clang agree on
// which): `int` while it fits, `unsigned` for a value that was written or counted up as one, `long` past that, and one
// past INT_MAX counted up from an `int` is a `long`. (Microsoft C has `int` for every one of them: `sysv`.)
#include <limits.h>
#include <stdio.h>

enum counted_up { AT_INT_MAX = INT_MAX, ONE_MORE, THE_SIZE_OF_IT = sizeof(ONE_MORE), OF_THE_FIRST = sizeof(AT_INT_MAX) };
enum written { UNSIGNED = 0xFFFFFFFF, THE_SIZE_OF_THAT = sizeof(UNSIGNED), WIDE = 2147483648, OF_THE_WIDE = sizeof(WIDE) };
enum from_unsigned { ALL_ONES = UINT_MAX, PAST_IT, SIZE_PAST_IT = sizeof(PAST_IT) };

int main(void) {
  printf("%d %d | %d %d | %d\n", THE_SIZE_OF_IT, OF_THE_FIRST, THE_SIZE_OF_THAT, OF_THE_WIDE, SIZE_PAST_IT);
  printf("%lld %lld %lld\n", (long long)ONE_MORE, (long long)WIDE, (long long)PAST_IT);
  return 0;
}
