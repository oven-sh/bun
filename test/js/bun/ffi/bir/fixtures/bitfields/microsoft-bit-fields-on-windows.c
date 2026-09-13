// Microsoft's bit-field layout is what every structure has on Windows: the expectation is what clang's
// record layouts (--target=x86_64-pc-windows-msvc -Xclang -fdump-record-layouts) say.
#define MS
#include "microsoft-bit-field-family.c"

int main(void) {
  layouts();
  values();
  return 0;
}
