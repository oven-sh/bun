// Microsoft's bit-field layout where a structure asks for it: __attribute__((ms_struct)) and #pragma ms_struct,
// with __attribute__((gcc_struct)) as the way back. (Clang lays these out the same; GCC, which has the
// attribute only on x86, agrees on everything here but the alignment of a union of bit-fields.)
#define MS __attribute__((ms_struct))
#define MS_PRAGMA 1
#include "microsoft-bit-field-family.c"

int main(void) {
  layouts();
  values();
  return 0;
}
