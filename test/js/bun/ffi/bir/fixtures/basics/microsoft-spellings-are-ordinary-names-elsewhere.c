// Microsoft's keywords are keywords only where Microsoft C is the language: anywhere else a program may use the
// names, and a structure without members has no size.
#include <stdio.h>
int __int64 = 1, __cdecl = 2, __forceinline = 3, __try = 4, __leave = 5, __unaligned = 6;
struct empty {};
int main(void) {
  printf("%d %d\n", __int64 + __cdecl + __forceinline + __try + __leave + __unaligned, (int)sizeof(struct empty));
  return 0;
}
