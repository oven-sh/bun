// A function can be given any name with an assembler label. Whatever it is, JavaScript finds the function under that
// name: one that reads as an array index, the names every object already has, an empty one.
int seven(void) __asm__("7");
int seven(void) { return 7; }
int zero(void) __asm__("0");
int zero(void) { return 100; }
int large_index(void) __asm__("4294967294");
int large_index(void) { return 101; }
int not_quite_an_index(void) __asm__("4294967295");
int not_quite_an_index(void) { return 102; }
int negative(void) __asm__("-1");
int negative(void) { return 103; }
int constructor_(void) __asm__("constructor");
int constructor_(void) { return 105; }
int to_string(void) __asm__("toString");
int to_string(void) { return 106; }
int then_(void) __asm__("then");
int then_(void) { return 107; }
int with_a_space(void) __asm__("a b");
int with_a_space(void) { return 108; }
int accented(void) __asm__("\303\251t\303\251");
int accented(void) { return 109; }
int plain(void) { return seven() + zero(); }
