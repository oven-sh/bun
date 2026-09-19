// A nest of always_inline functions that doubles at every level is inlined as far as one function's allowance goes
// and called from there on: compiling it takes a moment, not minutes, and the answer is the same.
#include <stdio.h>

#define ALWAYS static inline __attribute__((always_inline))
ALWAYS int level_0(int x) { return x; }
ALWAYS int level_1(int x) { return level_0(x) + level_0(x + 1); }
ALWAYS int level_2(int x) { return level_1(x) + level_1(x + 1); }
ALWAYS int level_3(int x) { return level_2(x) + level_2(x + 1); }
ALWAYS int level_4(int x) { return level_3(x) + level_3(x + 1); }
ALWAYS int level_5(int x) { return level_4(x) + level_4(x + 1); }
ALWAYS int level_6(int x) { return level_5(x) + level_5(x + 1); }
ALWAYS int level_7(int x) { return level_6(x) + level_6(x + 1); }
ALWAYS int level_8(int x) { return level_7(x) + level_7(x + 1); }
ALWAYS int level_9(int x) { return level_8(x) + level_8(x + 1); }
ALWAYS int level_10(int x) { return level_9(x) + level_9(x + 1); }
ALWAYS int level_11(int x) { return level_10(x) + level_10(x + 1); }
ALWAYS int level_12(int x) { return level_11(x) + level_11(x + 1); }
ALWAYS int level_13(int x) { return level_12(x) + level_12(x + 1); }
ALWAYS int level_14(int x) { return level_13(x) + level_13(x + 1); }
ALWAYS int level_15(int x) { return level_14(x) + level_14(x + 1); }
ALWAYS int level_16(int x) { return level_15(x) + level_15(x + 1); }
ALWAYS int level_17(int x) { return level_16(x) + level_16(x + 1); }
ALWAYS int level_18(int x) { return level_17(x) + level_17(x + 1); }
ALWAYS int level_19(int x) { return level_18(x) + level_18(x + 1); }
ALWAYS int level_20(int x) { return level_19(x) + level_19(x + 1); }

// The same nest given a constant folds away; so does one that does not double.
ALWAYS int line_0(int x) { return x + 1; }
ALWAYS int line_1(int x) { return line_0(x) + 1; }
ALWAYS int line_2(int x) { return line_1(x) + 1; }
ALWAYS int line_3(int x) { return line_2(x) + 1; }
ALWAYS int line_4(int x) { return line_3(x) + 1; }
ALWAYS int line_5(int x) { return line_4(x) + 1; }
ALWAYS int line_6(int x) { return line_5(x) + 1; }
ALWAYS int line_7(int x) { return line_6(x) + 1; }
ALWAYS int line_8(int x) { return line_7(x) + 1; }
ALWAYS int line_9(int x) { return line_8(x) + 1; }
ALWAYS int line_10(int x) { return line_9(x) + 1; }
ALWAYS int line_11(int x) { return line_10(x) + 1; }
ALWAYS int line_12(int x) { return line_11(x) + 1; }
ALWAYS int line_13(int x) { return line_12(x) + 1; }
ALWAYS int line_14(int x) { return line_13(x) + 1; }
ALWAYS int line_15(int x) { return line_14(x) + 1; }
ALWAYS int line_16(int x) { return line_15(x) + 1; }
ALWAYS int line_17(int x) { return line_16(x) + 1; }
ALWAYS int line_18(int x) { return line_17(x) + 1; }
ALWAYS int line_19(int x) { return line_18(x) + 1; }
ALWAYS int line_20(int x) { return line_19(x) + 1; }
ALWAYS int line_21(int x) { return line_20(x) + 1; }
ALWAYS int line_22(int x) { return line_21(x) + 1; }
ALWAYS int line_23(int x) { return line_22(x) + 1; }
ALWAYS int line_24(int x) { return line_23(x) + 1; }
ALWAYS int line_25(int x) { return line_24(x) + 1; }
ALWAYS int line_26(int x) { return line_25(x) + 1; }
ALWAYS int line_27(int x) { return line_26(x) + 1; }
ALWAYS int line_28(int x) { return line_27(x) + 1; }
ALWAYS int line_29(int x) { return line_28(x) + 1; }
ALWAYS int line_30(int x) { return line_29(x) + 1; }
ALWAYS int line_31(int x) { return line_30(x) + 1; }
ALWAYS int line_32(int x) { return line_31(x) + 1; }
ALWAYS int line_33(int x) { return line_32(x) + 1; }
ALWAYS int line_34(int x) { return line_33(x) + 1; }
ALWAYS int line_35(int x) { return line_34(x) + 1; }
ALWAYS int line_36(int x) { return line_35(x) + 1; }
ALWAYS int line_37(int x) { return line_36(x) + 1; }
ALWAYS int line_38(int x) { return line_37(x) + 1; }
ALWAYS int line_39(int x) { return line_38(x) + 1; }
ALWAYS int line_40(int x) { return line_39(x) + 1; }


int main(int argc, char **argv) {
  (void)argv;
  // level_k(x) = 2^k * x + k * 2^(k - 1)
  printf("%d %d %d %d\n", level_4(argc), level_12(argc), level_16(argc), level_20(argc));
  printf("%d\n", level_20(3));
  printf("%d %d\n", line_40(argc), line_40(100));
  return 0;
}
