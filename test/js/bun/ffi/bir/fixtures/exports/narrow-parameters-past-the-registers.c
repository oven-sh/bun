// Functions JavaScript calls whose ninth and later parameters are narrower than an int: no register is left for
// them, and where they go on the stack is the target's business (Apple's arm64 packs them at their own size). What
// arrives is the value JavaScript passed, converted as the parameter's type says, whatever lies next to it.
long long mixed(long long r1, long long r2, long long r3, long long r4, long long r5, long long r6, long long r7, long long r8, char c1, char c2, short s1, int i1, char c3, long long l1, short s2, float f1, char c4) {
  return r1 + r8 + c1 * 3LL + c2 * 5LL + s1 * 7LL + i1 * 11LL + c3 * 13LL + l1 * 17LL + s2 * 19LL + (long long)(f1 * 23) + c4 * 29LL;
}
long long bytes(long long r1, long long r2, long long r3, long long r4, long long r5, long long r6, long long r7, long long r8, signed char a, unsigned char b, signed char c, unsigned char d, signed char e, unsigned char f, signed char g, unsigned char h, signed char i) {
  return r2 + a + b * 2LL + c * 3LL + d * 4LL + e * 5LL + f * 6LL + g * 7LL + h * 8LL + i * 9LL;
}
long long shorts_and_bools(long long r1, long long r2, long long r3, long long r4, long long r5, long long r6, long long r7, long long r8, short a, _Bool b, unsigned short c, _Bool d, short e, char f) {
  return r3 + a + b * 2LL + c * 4LL + d * 8LL + e * 16LL + f * 32LL;
}
long long after_the_doubles(double d1, double d2, double d3, double d4, double d5, double d6, double d7, double d8, float f1, char c1, float f2, short s1) {
  return (long long)(d1 + d8 + f1 * 3 + f2 * 5) + c1 * 7LL + s1 * 11LL;
}
// And C calling back into JavaScript with as many.
long long through_a_callback(long long (*callback)(long long, long long, long long, long long, long long, long long, long long, long long, char, short, char, int, unsigned char)) {
  return callback(1, 2, 3, 4, 5, 6, 7, 8, -1, -300, 100, -70000, 200);
}
