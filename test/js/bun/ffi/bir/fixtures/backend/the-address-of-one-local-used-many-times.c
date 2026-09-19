// One local whose address is wanted in many places of one function: by atomic operations of every width (whose
// address operand is used inside a retry loop), by compare-and-swap in both outcomes, by a vector select, as the
// VALUE an atomic exchange stores, by plain loads and stores, by calls, by comparisons. The address must be the
// same, and be available, at every one of them; then the same with the local inside a loop, and with an element.
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#define NOINLINE __attribute__((noinline))
static int checks, wrong;
#define CHECK(c) do { int holds = (c) ? 1 : 0; checks++; wrong += !holds; printf("%s => %d\n", #c, holds); } while (0)

typedef int vector4 __attribute__((vector_size(16)));
union cell { uint8_t b; uint16_t h; uint32_t w; uint64_t q; vector4 v; void *p; };

static void *kept;
static NOINLINE void remember(void *p) { kept = p; }
static NOINLINE uint64_t read_through(const union cell *c) { return c->q; }
static NOINLINE void write_through(union cell *c, uint64_t value) { c->q = value; }
static void *volatile published;

static NOINLINE int every_use_of_one_address(uint64_t seed) {
  union cell cell;
  memset(&cell, 0, sizeof cell);
  remember(&cell);                                                                   // 1: passed to a call
  cell.q = seed;                                                                     // 2: plain store
  CHECK(read_through(&cell) == seed);                                                 // 3: passed again
  // 8, 16, 32 and 64 bits: every read-modify-write, results used.
  cell.b = 0x10;
  CHECK(__atomic_fetch_add(&cell.b, 5, __ATOMIC_SEQ_CST) == 0x10 && __atomic_fetch_and(&cell.b, 0x1c, __ATOMIC_SEQ_CST) == 0x15 && __atomic_fetch_or(&cell.b, 0x03, __ATOMIC_SEQ_CST) == 0x14);
  CHECK(__atomic_fetch_xor(&cell.b, 0xff, __ATOMIC_SEQ_CST) == 0x17 && __atomic_exchange_n(&cell.b, 0x42, __ATOMIC_SEQ_CST) == 0xe8 && __atomic_fetch_sub(&cell.b, 2, __ATOMIC_SEQ_CST) == 0x42 && cell.b == 0x40);
  cell.h = 0x1000;
  CHECK(__atomic_fetch_add(&cell.h, 5, __ATOMIC_SEQ_CST) == 0x1000 && __atomic_fetch_and(&cell.h, 0x100c, __ATOMIC_SEQ_CST) == 0x1005 && __atomic_fetch_or(&cell.h, 0x0300, __ATOMIC_SEQ_CST) == 0x1004);
  CHECK(__atomic_fetch_xor(&cell.h, 0xffff, __ATOMIC_SEQ_CST) == 0x1304 && __atomic_exchange_n(&cell.h, 0x4242, __ATOMIC_SEQ_CST) == 0xecfb && __atomic_add_fetch(&cell.h, 1, __ATOMIC_SEQ_CST) == 0x4243);
  cell.w = 0x10000000u;
  CHECK(__atomic_fetch_add(&cell.w, 5, __ATOMIC_SEQ_CST) == 0x10000000u && __atomic_fetch_and(&cell.w, 0x1000000cu, __ATOMIC_SEQ_CST) == 0x10000005u && __atomic_fetch_or(&cell.w, 0x30000u, __ATOMIC_SEQ_CST) == 0x10000004u);
  CHECK(__atomic_fetch_xor(&cell.w, 0xffffffffu, __ATOMIC_SEQ_CST) == 0x10030004u && __atomic_exchange_n(&cell.w, 0x42424242u, __ATOMIC_SEQ_CST) == 0xeffcfffbu && __atomic_nand_fetch(&cell.w, 0xff, __ATOMIC_SEQ_CST) == ~(0x42424242u & 0xff));
  cell.q = 0x1000000000000000ull;
  CHECK(__atomic_fetch_add(&cell.q, 5, __ATOMIC_SEQ_CST) == 0x1000000000000000ull && __atomic_fetch_and(&cell.q, 0x100000000000000cull, __ATOMIC_SEQ_CST) == 0x1000000000000005ull);
  CHECK(__atomic_fetch_or(&cell.q, 0x300000000ull, __ATOMIC_SEQ_CST) == 0x1000000000000004ull && __atomic_fetch_xor(&cell.q, ~0ull, __ATOMIC_SEQ_CST) == 0x1000000300000004ull);
  CHECK(__atomic_exchange_n(&cell.q, seed, __ATOMIC_SEQ_CST) == 0xeffffffcfffffffbull && __atomic_load_n(&cell.q, __ATOMIC_ACQUIRE) == seed);
  // Compare and swap, strong and weak, succeeding and failing; the expected value is written back on failure.
  uint32_t expected32 = (uint32_t)seed;
  cell.w = (uint32_t)seed;
  CHECK(__atomic_compare_exchange_n(&cell.w, &expected32, 7u, 0, __ATOMIC_SEQ_CST, __ATOMIC_SEQ_CST) && cell.w == 7 && expected32 == (uint32_t)seed);
  CHECK(!__atomic_compare_exchange_n(&cell.w, &expected32, 8u, 0, __ATOMIC_SEQ_CST, __ATOMIC_RELAXED) && cell.w == 7 && expected32 == 7);
  uint64_t expected64 = 1;
  cell.q = 2;
  CHECK(!__atomic_compare_exchange_n(&cell.q, &expected64, 3ull, 1, __ATOMIC_ACQ_REL, __ATOMIC_ACQUIRE) && expected64 == 2);
  int swapped = 0;
  for (int tries = 0; tries < 100 && !swapped; tries++) swapped = __atomic_compare_exchange_n(&cell.q, &expected64, 3ull, 1, __ATOMIC_ACQ_REL, __ATOMIC_ACQUIRE);
  CHECK(swapped && cell.q == 3 && expected64 == 2);
  uint8_t expected8 = 3; uint16_t expected16 = 0;
  CHECK(__atomic_compare_exchange_n(&cell.b, &expected8, (uint8_t)9, 0, __ATOMIC_SEQ_CST, __ATOMIC_SEQ_CST) && cell.b == 9);
  cell.h = 0xbeef;
  CHECK(!__atomic_compare_exchange_n(&cell.h, &expected16, (uint16_t)1, 0, __ATOMIC_SEQ_CST, __ATOMIC_SEQ_CST) && expected16 == 0xbeef && cell.h == 0xbeef);
  // A vector select on values that live in the local.
  cell.v = (vector4){1, -2, 3, -4};
  vector4 negative = cell.v < 0;
#ifdef __BUN_CC__
  cell.v = negative ? -cell.v : cell.v * 10;          // (GCC and Clang have this operator for vectors in C++ only)
#else
  cell.v = (negative & -cell.v) | (~negative & (cell.v * 10));
#endif
  CHECK(cell.v[0] == 10 && cell.v[1] == 2 && cell.v[2] == 30 && cell.v[3] == 4);
  // The address itself as the value an atomic operation stores and returns.
  void *previous = __atomic_exchange_n(&published, (void *)&cell, __ATOMIC_SEQ_CST);
  CHECK(previous == 0 && published == (void *)&cell && kept == (void *)&cell);
  void *expected_pointer = &cell;
  CHECK(__atomic_compare_exchange_n(&published, &expected_pointer, (void *)0, 0, __ATOMIC_SEQ_CST, __ATOMIC_SEQ_CST) && published == 0);
  cell.p = &cell;
  CHECK(cell.p == kept && (char *)&cell.b == (char *)&cell && (uintptr_t)&cell % 16 == 0);
  write_through(&cell, seed + 1);
  CHECK(cell.q == seed + 1);
  return 1;
}

// The same local inside a loop: a new address need not be the same one each time round, but within one round it is.
static NOINLINE int in_a_loop(int rounds) {
  int ok = 1;
  for (int i = 0; i < rounds; i++) {
    union cell cell;
    cell.q = (uint64_t)i;
    remember(&cell);
    ok &= __atomic_fetch_add(&cell.q, 1, __ATOMIC_SEQ_CST) == (uint64_t)i && __atomic_fetch_add(&cell.w, 1, __ATOMIC_SEQ_CST) == (uint32_t)i + 1;
    uint64_t expected = (uint64_t)i + 2;
    ok &= __atomic_compare_exchange_n(&cell.q, &expected, 100ull, 0, __ATOMIC_SEQ_CST, __ATOMIC_SEQ_CST) && read_through(&cell) == 100 && kept == (void *)&cell;
    ok &= __atomic_fetch_or(&cell.h, 0x100, __ATOMIC_SEQ_CST) == 100 && __atomic_fetch_xor(&cell.b, 1, __ATOMIC_SEQ_CST) == 100 && cell.q == (0x100 | 100) + 1;
    ok &= __atomic_exchange_n(&published, (void *)&cell, __ATOMIC_SEQ_CST) != (void *)1 && published == kept;
  }
  published = 0;
  return ok;
}

// The address of an element chosen at run time.
static NOINLINE int of_an_element(int n) {
  uint32_t array[16];
  int ok = 1;
  for (int i = 0; i < 16; i++) array[i] = (uint32_t)i;
  for (int i = 0; i < n; i++) {
    uint32_t *at = &array[i];
    remember(at);
    ok &= __atomic_fetch_add(&array[i], 10, __ATOMIC_SEQ_CST) == (uint32_t)i && __atomic_fetch_add(at, 10, __ATOMIC_SEQ_CST) == (uint32_t)i + 10;
    uint32_t expected = (uint32_t)i + 20;
    ok &= __atomic_compare_exchange_n(&array[i], &expected, 7u, 0, __ATOMIC_SEQ_CST, __ATOMIC_SEQ_CST) && *at == 7 && kept == (void *)&array[i];
    ok &= __atomic_exchange_n(&array[i], (uint32_t)i, __ATOMIC_SEQ_CST) == 7 && __atomic_fetch_and(&array[i], 0xf, __ATOMIC_SEQ_CST) == (uint32_t)i && &array[i] - array == i;
  }
  for (int i = 0; i < 16; i++) ok &= array[i] == (uint32_t)i;
  return ok;
}

int main(void) {
  CHECK(every_use_of_one_address(0x123456789abcdef0ull));
  CHECK(every_use_of_one_address(3));
  CHECK(in_a_loop(1000));
  CHECK(of_an_element(16));
  printf("%d checks, %d wrong\n", checks, wrong);
  return wrong != 0;
}
