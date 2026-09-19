/* The __atomic_* and __sync_* builtins on every integer width, with operands that wrap around
   at each of them. Every line is: what the call returned, what is in the object afterwards,
   and whether the bytes beside the object are still what they were. The expected output is
   what clang prints for the same file. */
#include <stdio.h>

typedef unsigned long long u64;

#define OPS(X) X(add) X(sub) X(and) X(or) X(xor) X(nand)

#define TEST(T, NAME)                                                                                        \
  static struct { u64 before; T cell; T expected; T input; T output; u64 after; } NAME##_memory;             \
  static int NAME##_intact(void) { return NAME##_memory.before == 0xa5a5a5a5a5a5a5a5ULL && NAME##_memory.after == 0x5a5a5a5a5a5a5a5aULL; } \
  static void NAME##_line(const char *what, u64 returned) {                                                  \
    printf("  %-18s %llx -> %llx%s\n", what, returned, (u64)NAME##_memory.cell, NAME##_intact() ? "" : " CLOBBERED"); \
  }                                                                                                          \
  static void NAME##_test(u64 start_bits, u64 operand_bits) {                                                \
    T start = (T)start_bits, operand = (T)operand_bits;                                                      \
    T *p = &NAME##_memory.cell;                                                                              \
    NAME##_memory.before = 0xa5a5a5a5a5a5a5a5ULL; NAME##_memory.after = 0x5a5a5a5a5a5a5a5aULL;               \
    printf(" %llx %llx\n", (u64)start, (u64)operand);                                                        \
    *p = start; NAME##_line("load", (u64)__atomic_load_n(p, __ATOMIC_ACQUIRE));                              \
    __atomic_store_n(p, operand, __ATOMIC_RELEASE); NAME##_line("store", 0);                                 \
    NAME##_line("exchange", (u64)__atomic_exchange_n(p, start, __ATOMIC_ACQ_REL));                           \
    OPS(NAME##_RMW)                                                                                          \
    *p = start; NAME##_line("fetch_min", (u64)__atomic_fetch_min(p, operand, __ATOMIC_SEQ_CST));             \
    *p = start; NAME##_line("fetch_max", (u64)__atomic_fetch_max(p, operand, __ATOMIC_SEQ_CST));             \
    /* Compare-and-swap: success leaves `expected` alone, failure rewrites it. */                            \
    *p = start; NAME##_memory.expected = start;                                                              \
    NAME##_line("cas", (u64)__atomic_compare_exchange_n(p, &NAME##_memory.expected, operand, 0, __ATOMIC_SEQ_CST, __ATOMIC_RELAXED) * 16 + (NAME##_memory.expected == start)); \
    NAME##_memory.expected = (T)(start ^ 1);                                                                 \
    NAME##_line("cas stale", (u64)__atomic_compare_exchange_n(p, &NAME##_memory.expected, (T)(operand + 7), 1, __ATOMIC_ACQ_REL, __ATOMIC_ACQUIRE) * 16 + (NAME##_memory.expected == operand)); \
    *p = start; __atomic_load(p, &NAME##_memory.output, __ATOMIC_SEQ_CST); NAME##_line("load to", (u64)NAME##_memory.output); \
    NAME##_memory.input = operand; __atomic_store(p, &NAME##_memory.input, __ATOMIC_SEQ_CST); NAME##_line("store from", 0); \
    NAME##_memory.input = start; __atomic_exchange(p, &NAME##_memory.input, &NAME##_memory.output, __ATOMIC_SEQ_CST); NAME##_line("exchange through", (u64)NAME##_memory.output); \
    NAME##_memory.expected = start; NAME##_memory.input = operand;                                           \
    NAME##_line("cas through", (u64)__atomic_compare_exchange(p, &NAME##_memory.expected, &NAME##_memory.input, 0, __ATOMIC_SEQ_CST, __ATOMIC_SEQ_CST)); \
    NAME##_line("sync bool", (u64)__sync_bool_compare_and_swap(p, operand, start));                          \
    NAME##_line("sync bool stale", (u64)__sync_bool_compare_and_swap(p, operand, start));                    \
    NAME##_line("sync val", (u64)__sync_val_compare_and_swap(p, start, operand));                            \
    NAME##_line("sync test and set", (u64)__sync_lock_test_and_set(p, start));                               \
    __sync_lock_release(p); __sync_synchronize(); NAME##_line("sync release", 0);                            \
  }

#define RMW(NAME, T, op)                                                                                     \
  *p = start; NAME##_line("fetch_" #op, (u64)__atomic_fetch_##op(p, operand, __ATOMIC_SEQ_CST));             \
  *p = start; NAME##_line(#op "_fetch", (u64)__atomic_##op##_fetch(p, operand, __ATOMIC_RELAXED));           \
  *p = start; NAME##_line("sync fetch_" #op, (u64)__sync_fetch_and_##op(p, operand));                        \
  *p = start; NAME##_line("sync " #op "_fetch", (u64)__sync_##op##_and_fetch(p, operand));

#define s8_RMW(op) RMW(s8, signed char, op)
#define u8_RMW(op) RMW(u8, unsigned char, op)
#define s16_RMW(op) RMW(s16, short, op)
#define u16_RMW(op) RMW(u16, unsigned short, op)
#define s32_RMW(op) RMW(s32, int, op)
#define u32_RMW(op) RMW(u32, unsigned int, op)
#define s64_RMW(op) RMW(s64, long long, op)
#define u64_RMW(op) RMW(u64, unsigned long long, op)

TEST(signed char, s8)
TEST(unsigned char, u8)
TEST(short, s16)
TEST(unsigned short, u16)
TEST(int, s32)
TEST(unsigned int, u32)
TEST(long long, s64)
TEST(unsigned long long, u64)

#define RUN(NAME)                                        \
  printf(#NAME "\n");                                    \
  NAME##_test(~0ULL, 1);                                 \
  NAME##_test(0, 1);                                     \
  NAME##_test(0x7f7f7f7f7f7f7f7fULL, 0x0101010101010181ULL); \
  NAME##_test(0x123456789abcdef0ULL, 0xfedcba9876543210ULL);

int main(void) {
  RUN(s8) RUN(u8) RUN(s16) RUN(u16) RUN(s32) RUN(u32) RUN(s64) RUN(u64)
  return 0;
}
