// What <intrin.h> declares for x64 and the compiler has built in, each called and checked: bit scans and counts,
// rotates, byte swaps, wide multiplication and division, bit tests, the interlocked family in every width, string
// moves and stores, barriers, and the ones that ask the processor about itself.
#include <intrin.h>
#include <stdio.h>
#include <string.h>

static int wrong;
#define CHECK(c) do { if (!(c)) { wrong++; printf("WRONG (line %d): %s\n", __LINE__, #c); } } while (0)

static __declspec(noinline) void *who_called(void) { return _ReturnAddress(); }

int main(int argc, char **argv) {
  (void)argv;
  unsigned long index = 99;
  // Bit scans: whether any bit was set, and where.
  CHECK(_BitScanForward(&index, 0x50) == 1 && index == 4 && _BitScanReverse(&index, 0x50) == 1 && index == 6 && _BitScanForward(&index, 0) == 0);
  CHECK(_BitScanForward64(&index, 1ull << 40) == 1 && index == 40 && _BitScanReverse64(&index, (1ull << 40) | 1) == 1 && index == 40 && _BitScanReverse64(&index, 0) == 0);
  CHECK(__popcnt16(0xf0f0) == 8 && __popcnt(0xf0f0f0f0u) == 16 && __popcnt64(0xf0f0f0f0f0f0f0f0ull) == 32);
  CHECK(__lzcnt16(1) == 15 && __lzcnt(1) == 31 && __lzcnt64(1) == 63 && __lzcnt(0) == 32);
  // Rotates and byte swaps.
  CHECK(_rotl8(0x81, 1) == 0x03 && _rotr8(0x81, 1) == 0xc0 && _rotl16(0x8001, 4) == 0x0018 && _rotr16(0x8001, 4) == 0x1800);
  CHECK(_rotl(0x80000001u, 4) == 0x00000018u && _rotr(0x80000001u, 4) == 0x18000000u && _lrotl(0x80000001ul, 1) == 3ul && _lrotr(3ul, 1) == 0x80000001ul);
  CHECK(_rotl64(0x8000000000000001ull, 4) == 0x18ull && _rotr64(0x18ull, 4) == 0x8000000000000001ull);
  CHECK(_byteswap_ushort(0x1234) == 0x3412 && _byteswap_ulong(0x12345678ul) == 0x78563412ul && _byteswap_uint64(0x0102030405060708ull) == 0x0807060504030201ull);
  // Wide arithmetic.
  unsigned __int64 high = 0, remainder = 0; __int64 signed_high = 0, signed_remainder = 0;
  CHECK(__emul(-70000, 70000) == -4900000000ll && __emulu(4000000000u, 4u) == 16000000000ull);
  CHECK(__mulh(-1, 5) == -1 && __umulh(1ull << 63, 4) == 2 && _umul128(1ull << 63, 6, &high) == 0 && high == 3);
  CHECK(_mul128(-1, 5, &signed_high) == -5 && signed_high == -1);
  CHECK(__shiftleft128(1, 0, 4) == 0 && __shiftleft128(0xf000000000000000ull, 1, 4) == 0x1f && __shiftright128(0, 0xf, 4) == 0xf000000000000000ull);
  CHECK(_udiv128(1, 0, 16, &remainder) == 1ull << 60 && remainder == 0 && _div128(-1, -100, 7, &signed_remainder) == -14 && signed_remainder == -2);
  CHECK(__ll_lshift(1, 40) == 1ull << 40 && __ll_rshift(-256, 4) == -16 && __ull_rshift(1ull << 63, 63) == 1 && _abs64(-5000000000ll) == 5000000000ll);
  // Bit tests.
  long bits = 0x5; __int64 wide_bits = 0;
  CHECK(_bittest(&bits, 0) == 1 && _bittest(&bits, 1) == 0 && _bittestandset(&bits, 1) == 0 && bits == 7 && _bittestandreset(&bits, 0) == 1 && bits == 6 && _bittestandcomplement(&bits, 3) == 0 && bits == 14);
  CHECK(_bittestandset64(&wide_bits, 40) == 0 && _bittest64(&wide_bits, 40) == 1 && _bittestandcomplement64(&wide_bits, 40) == 1 && wide_bits == 0 && _bittestandreset64(&wide_bits, 3) == 0);
  // The interlocked family: each returns what the documentation says (the old value, or the new one for the counts).
  char volatile c8 = 1; short volatile s16 = 1; long volatile l32 = 1; __int64 volatile q64 = 1; void *volatile pointer = 0;
  CHECK(_InterlockedExchange8(&c8, 2) == 1 && _InterlockedExchangeAdd8(&c8, 3) == 2 && _InterlockedCompareExchange8(&c8, 9, 5) == 5 && c8 == 9 && _InterlockedAnd8(&c8, 1) == 9 && _InterlockedOr8(&c8, 6) == 1 && _InterlockedXor8(&c8, 7) == 7 && c8 == 0);
  CHECK(_InterlockedExchange16(&s16, 2) == 1 && _InterlockedExchangeAdd16(&s16, 3) == 2 && _InterlockedCompareExchange16(&s16, 9, 4) == 5 && s16 == 5 && _InterlockedIncrement16(&s16) == 6 && _InterlockedDecrement16(&s16) == 5 && _InterlockedAnd16(&s16, 4) == 5 && _InterlockedOr16(&s16, 3) == 4 && _InterlockedXor16(&s16, 7) == 7);
  CHECK(_InterlockedExchange(&l32, 2) == 1 && _InterlockedExchangeAdd(&l32, 3) == 2 && _InterlockedCompareExchange(&l32, 9, 5) == 5 && l32 == 9 && _InterlockedIncrement(&l32) == 10 && _InterlockedDecrement(&l32) == 9 && _InterlockedAdd(&l32, 11) == 20 && _InterlockedAnd(&l32, 4) == 20 && _InterlockedOr(&l32, 3) == 4 && _InterlockedXor(&l32, 7) == 7);
  CHECK(_InterlockedExchange64(&q64, 2) == 1 && _InterlockedExchangeAdd64(&q64, 1ll << 40) == 2 && _InterlockedCompareExchange64(&q64, 9, (1ll << 40) + 2) == (1ll << 40) + 2 && q64 == 9 && _InterlockedIncrement64(&q64) == 10 && _InterlockedDecrement64(&q64) == 9 && _InterlockedAdd64(&q64, 1) == 10 && _InterlockedAnd64(&q64, 2) == 10 && _InterlockedOr64(&q64, 5) == 2 && _InterlockedXor64(&q64, 7) == 7);
  CHECK(_InterlockedExchangePointer(&pointer, &bits) == 0 && _InterlockedCompareExchangePointer(&pointer, &wide_bits, &bits) == (void *)&bits && pointer == (void *)&wide_bits);
  CHECK(_InterlockedExchange_acq(&l32, 1) == 0 && _InterlockedIncrement_rel(&l32) == 2 && _InterlockedCompareExchange_nf(&l32, 5, 2) == 2 && l32 == 5);
  l32 = 0; q64 = 0;
  CHECK(_interlockedbittestandset(&l32, 3) == 0 && _interlockedbittestandset(&l32, 3) == 1 && _interlockedbittestandreset(&l32, 3) == 1 && l32 == 0 && _interlockedbittestandset64(&q64, 40) == 0 && _interlockedbittestandreset64(&q64, 40) == 1);
  // String moves and stores.
  unsigned char from[16] = "0123456789abcde", to[16] = {0};
  __movsb(to, from, 16);
  CHECK(memcmp(to, from, 16) == 0);
  unsigned short words[4] = {0}; unsigned long dwords[4] = {0}; unsigned __int64 qwords[2] = {0};
  __movsw(words, (unsigned short *)from, 4); __movsd(dwords, (unsigned long *)from, 4); __movsq(qwords, (unsigned __int64 *)from, 2);
  CHECK(memcmp(words, from, 8) == 0 && memcmp(dwords, from, 16) == 0 && memcmp(qwords, from, 16) == 0);
  __stosb(to, 0x5a, 16); __stosw(words, 0x1234, 4); __stosd(dwords, 0x12345678ul, 4); __stosq(qwords, 0x0102030405060708ull, 2);
  CHECK(to[15] == 0x5a && words[3] == 0x1234 && dwords[3] == 0x12345678ul && qwords[1] == 0x0102030405060708ull);
  // Volatile accesses of a given width, barriers, and the instructions that do nothing visible.
  char volatile v8 = 0; short volatile v16 = 0; int volatile v32 = 0; __int64 volatile v64 = 0;
  __iso_volatile_store8(&v8, 1); __iso_volatile_store16(&v16, 2); __iso_volatile_store32(&v32, 3); __iso_volatile_store64(&v64, 4);
  CHECK(__iso_volatile_load8(&v8) == 1 && __iso_volatile_load16(&v16) == 2 && __iso_volatile_load32(&v32) == 3 && __iso_volatile_load64(&v64) == 4);
  _ReadWriteBarrier(); _ReadBarrier(); _WriteBarrier(); __faststorefence(); __nop();
  // The processor and the frame.
  int info[4] = {0};
  __cpuid(info, 0);
  int highest_leaf = info[0];
  __cpuidex(info, 1, 0);
  CHECK(highest_leaf >= 1 && (info[3] & (1 << 26)) != 0);      // SSE2, which x64 always has
  unsigned __int64 before = __rdtsc(), after = __rdtsc();
  CHECK(after >= before && who_called() != 0 && _AddressOfReturnAddress() != 0 && __readgsqword(0x30) != 0);
  // (__halt and __readeflags are refused when the program is compiled: see the diagnostics.)
  if (argc > 100) { __debugbreak(); __fastfail(7); __ud2(); }
  printf("%d wrong\n", wrong);
  return wrong != 0;
}
