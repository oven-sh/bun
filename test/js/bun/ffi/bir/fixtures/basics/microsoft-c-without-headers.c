// Microsoft C as the compiler itself knows it, with nothing included: the sized integer keywords, calling
// conventions, __declspec, the intrinsics (declared here the way <intrin.h> and <winnt.h> declare them),
// Microsoft's layout rules and its <stdarg.h> macros. Each check compares with the same thing in plain C.
int printf(const char *, ...);

static int checks, wrong;
static void check(const char *what, int ok) {
  checks++;
  if (!ok) {
    wrong++;
    printf("WRONG: %s\n", what);
  }
}
#define CHECK(condition) check(#condition, (condition) ? 1 : 0)

// ---- integers, conventions, decorations ----
typedef unsigned __int64 u64;
typedef __int64 unsigned also_u64;
typedef signed __int8 s8;
typedef unsigned __int16 u16;
typedef __int32 i32;
static int __cdecl plain(int x) { return x + 1; }
static int __stdcall standard(int x) { return x + 2; }
static int __fastcall fast(int x) { return x + 3; }
typedef int(__stdcall *callback)(int);
static int through(callback f, int (__fastcall *g)(int), int x) { return f(x) * 10 + g(x); }
__forceinline int forced(int x) { return x * 2; }
static __inline int inlined(int x) { return forced(x) + 1; }
static int load(__unaligned int *p) { return *p; }

// ---- __declspec ----
__declspec(align(64)) static char aligned_buffer[3];
struct __declspec(align(32)) wide_line { int x; };
__declspec(thread) static int per_thread = 5;
__declspec(selectany) int one_of_many = 7;
__declspec(noinline) static int kept(int x) { return x * 3; }
__declspec(noreturn) void exit(int);
__declspec(dllimport) int abs(int);

// ---- intrinsics ----
unsigned char _BitScanForward(unsigned long *, unsigned long);
unsigned char _BitScanReverse(unsigned long *, unsigned long);
unsigned char _BitScanForward64(unsigned long *, unsigned __int64);
unsigned char _BitScanReverse64(unsigned long *, unsigned __int64);
unsigned int __popcnt(unsigned int);
unsigned __int64 __popcnt64(unsigned __int64);
unsigned short _byteswap_ushort(unsigned short);
unsigned long _byteswap_ulong(unsigned long);
unsigned __int64 _byteswap_uint64(unsigned __int64);
unsigned char _rotl8(unsigned char, unsigned char);
unsigned short _rotr16(unsigned short, unsigned char);
unsigned int _rotl(unsigned int, int);
unsigned __int64 _rotr64(unsigned __int64, int);
unsigned __int64 _umul128(unsigned __int64, unsigned __int64, unsigned __int64 *);
unsigned __int64 __umulh(unsigned __int64, unsigned __int64);
__int64 __mulh(__int64, __int64);
unsigned __int64 _udiv128(unsigned __int64, unsigned __int64, unsigned __int64, unsigned __int64 *);
unsigned __int64 __shiftleft128(unsigned __int64, unsigned __int64, unsigned char);
unsigned __int64 __shiftright128(unsigned __int64, unsigned __int64, unsigned char);
long _InterlockedIncrement(long volatile *);
long _InterlockedDecrement(long volatile *);
long _InterlockedExchange(long volatile *, long);
long _InterlockedExchangeAdd(long volatile *, long);
long _InterlockedCompareExchange(long volatile *, long, long);
long _InterlockedOr(long volatile *, long);
long _InterlockedAnd(long volatile *, long);
char _InterlockedXor8(char volatile *, char);
short _InterlockedIncrement16(short volatile *);
__int64 _InterlockedCompareExchange64(__int64 volatile *, __int64, __int64);
__int64 _InterlockedExchangeAdd64(__int64 volatile *, __int64);
void *_InterlockedCompareExchangePointer(void *volatile *, void *, void *);
void *_InterlockedExchangePointer(void *volatile *, void *);
unsigned char _interlockedbittestandset(long volatile *, long);
unsigned char _bittest(long const *, long);
void _ReadWriteBarrier(void);
void __faststorefence(void);
void __stosb(unsigned char *, unsigned char, unsigned __int64);
void __movsb(unsigned char *, unsigned char const *, unsigned __int64);
#pragma intrinsic(_BitScanForward, _InterlockedIncrement, __stosb)
#if defined(_M_X64)
unsigned __int64 __rdtsc(void);
void __cpuid(int[4], int);
unsigned __int64 __readgsqword(unsigned long);
unsigned long __readgsdword(unsigned long);
void __nop(void);
#endif

static void intrinsics(void) {
  unsigned long index = 99;
  CHECK(_BitScanForward(&index, 0x50) == 1 && index == 4);
  CHECK(_BitScanReverse(&index, 0x50) == 1 && index == 6);
  CHECK(_BitScanForward64(&index, 1ui64 << 40) == 1 && index == 40);
  CHECK(_BitScanReverse64(&index, 0x8000000000000001ui64) == 1 && index == 63);
  index = 99;
  CHECK(_BitScanForward(&index, 0) == 0);
  CHECK(__popcnt(0xf0f0f0f1u) == 17 && __popcnt64(0xffffffff00000001ui64) == 33);
  CHECK(_byteswap_ushort(0x1234) == 0x3412 && _byteswap_ulong(0x12345678ul) == 0x78563412ul);
  CHECK(_byteswap_uint64(0x0102030405060708ui64) == 0x0807060504030201ui64);
  CHECK(_rotl8(0x81, 1) == 0x03 && _rotr16(0x8001, 1) == 0xc000 && _rotl(0x80000001u, 4) == 0x18u);
  CHECK(_rotr64(1, 1) == 0x8000000000000000ui64);
  u64 high = 0, low = _umul128(0xfedcba9876543210ui64, 0x123456789abcdef1ui64, &high);
  CHECK(high == 0x121fa00ad77d7423ui64 && low == 0x224a4396cc6d0110ui64);
  CHECK(__umulh(0xfedcba9876543210ui64, 0x123456789abcdef1ui64) == high);
  CHECK(__mulh(-3, 5) == -1 && __mulh(1i64 << 62, 4) == 1);
  u64 remainder = 0, quotient = _udiv128(1, 5, 10, &remainder);
  CHECK(quotient == 0x199999999999999aui64 && remainder == 1);
  CHECK(__shiftleft128(0x8000000000000000ui64, 1, 1) == 3 && __shiftright128(1, 3, 1) == 0x8000000000000000ui64);
  CHECK(__shiftleft128(5, 9, 64) == 9 && __shiftright128(5, 9, 0) == 5);

  static long volatile counter = 10;
  CHECK(_InterlockedIncrement(&counter) == 11 && _InterlockedDecrement(&counter) == 10);
  CHECK(_InterlockedExchangeAdd(&counter, 5) == 10 && counter == 15);
  CHECK(_InterlockedExchange(&counter, 3) == 15 && counter == 3);
  CHECK(_InterlockedCompareExchange(&counter, 8, 4) == 3 && counter == 3);
  CHECK(_InterlockedCompareExchange(&counter, 8, 3) == 3 && counter == 8);
  CHECK(_InterlockedOr(&counter, 3) == 8 && _InterlockedAnd(&counter, 9) == 11 && counter == 9);
  static char volatile byte = 0x0f;
  static short volatile half = 0x7fff;
  CHECK(_InterlockedXor8(&byte, 0x3c) == 0x0f && byte == 0x33 && _InterlockedIncrement16(&half) == -32768);
  static __int64 volatile wide = 1i64 << 40;
  CHECK(_InterlockedCompareExchange64(&wide, 7, 1i64 << 40) == 1i64 << 40 && _InterlockedExchangeAdd64(&wide, 1i64 << 33) == 7 && wide == (1i64 << 33) + 7);
  static void *volatile slot;
  CHECK(_InterlockedCompareExchangePointer(&slot, &index, 0) == 0 && _InterlockedExchangePointer(&slot, &high) == &index && slot == &high);
  static long volatile bits[2];
  CHECK(_interlockedbittestandset(bits, 35) == 0 && _interlockedbittestandset(bits, 35) == 1 && bits[1] == 8 && _bittest((long const *)bits, 35) == 1);
  _ReadWriteBarrier();
  __faststorefence();
  unsigned char bytes[8] = {0}, copy[8] = {0};
  __stosb(bytes + 1, 0x5a, 6);
  __movsb(copy, bytes, 8);
  CHECK(copy[0] == 0 && copy[1] == 0x5a && copy[6] == 0x5a && copy[7] == 0);
#if defined(_M_X64)
  u64 before = __rdtsc(), after = __rdtsc();
  CHECK(before != 0 && after >= before);
  int info[4] = {0};
  __cpuid(info, 0);
  CHECK(info[0] > 0 && info[1] != 0);
  // The thread environment block points at itself at offset 0x30, and holds this thread's id at 0x48.
  CHECK(__readgsqword(0x30) != 0 && *(u64 *)(__readgsqword(0x30) + 0x30) == __readgsqword(0x30));
  CHECK(__readgsdword(0x48) != 0);
  __nop();
#endif
}

// ---- layout ----
typedef struct tagPOINT { long x, y; } POINT;
typedef struct tagNAMED { POINT; char name[4]; } NAMED;  // a member that is a named type and nothing else
struct empty { };
enum small { A, B };
#define PACK(n) __pragma(pack(push, n))
PACK(2) struct packed_to_2 { char c; long long q; }; __pragma(pack(pop))
struct bits { char a : 3; int b : 4; char c : 2; };

// ---- variable arguments the way <vadefs.h> spells them ----
typedef char *va_list;
void __cdecl __va_start(va_list *, ...);
#if defined(_M_ARM64)
#define va_start(ap, x) ((void)(__va_start(&ap, &x, (sizeof(x) + 7) & ~7ull, __alignof(x), &x)))
#define va_arg(ap, t) ((sizeof(t) > 16) ? **(t **)((ap += 8) - 8) : *(t *)((ap += ((sizeof(t) + 7) & ~7ull)) - ((sizeof(t) + 7) & ~7ull)))
#else
#define va_start(ap, x) ((void)(__va_start(&ap, x)))
#define va_arg(ap, t) ((sizeof(t) > sizeof(__int64) || (sizeof(t) & (sizeof(t) - 1)) != 0) ? **(t **)((ap += sizeof(__int64)) - sizeof(__int64)) : *(t *)((ap += sizeof(__int64)) - sizeof(__int64)))
#endif
struct three { int a, b, c; };
static __int64 sum(int count, ...) {
  va_list list;
  va_start(list, count);
  __int64 total = 0;
  for (int i = 0; i < count; i++) total += va_arg(list, int);
  total += (__int64)va_arg(list, double);
  struct three t = va_arg(list, struct three);
  total += va_arg(list, __int64);
  return total + t.a + t.b + t.c;
}

int main(void) {
  CHECK(sizeof(u64) == 8 && sizeof(also_u64) == 8 && sizeof(s8) == 1 && sizeof(u16) == 2 && sizeof(i32) == 4);
  CHECK((u64)-1 > 0 && (s8)-1 < 0 && sizeof(long) == 4 && sizeof(long double) == 8 && sizeof(L'x') == 2);
  CHECK(sizeof(1i64) == 8 && 0xffui8 == 255 && 18446744073709551615ui64 == (u64)-1);
  CHECK(plain(1) == 2 && standard(1) == 3 && fast(1) == 4 && through(standard, fast, 5) == 78 && inlined(4) == 9);
  int word = 0x01020304;
  CHECK(load(&word) == 0x01020304 && __noop(undeclared_function(word), 1 / 0) == 0);
  __assume(word != 0);
  CHECK(((u64)aligned_buffer & 63) == 0 && sizeof(struct wide_line) == 32 && _Alignof(struct wide_line) == 32);
  per_thread += 1;
  CHECK(per_thread == 6 && one_of_many == 7 && kept(3) == 9 && abs(-4) == 4);
  intrinsics();
  NAMED named = {{1, 2}, "abc"};
  CHECK(sizeof(NAMED) == 12 && named.y == 2 && named.name[2] == 'c');
  CHECK(sizeof(struct empty) == 4 && sizeof(enum small) == 4 && (enum small)-1 < 0);
  CHECK(sizeof(struct packed_to_2) == 10 && sizeof(struct bits) == 12 && _Alignof(struct bits) == 4);
  struct three t = {100, 200, 300};
  CHECK(sum(3, 1, 2, 3, 40.5, t, 1i64 << 40) == 6 + 40 + 600 + (1i64 << 40));
  printf("%s, %d wrong\n", checks >= 38 ? "every check made" : "checks are missing", wrong);
  return wrong != 0;
}
