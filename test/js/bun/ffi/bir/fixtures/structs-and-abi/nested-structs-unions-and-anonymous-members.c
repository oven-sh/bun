struct Inner { char tag; double weight; };
         struct Outer { short id; struct Inner inner; union { int i; float f; unsigned char bytes[4]; }; struct { int a, b; } pair; };
         union Bits { unsigned u; float f; };
         int layout(void) {
             struct Outer o;
             return sizeof(struct Inner) * 1000 + sizeof o + (int)((char *)&o.inner.weight - (char *)&o) + (int)((char*)&o.pair.b - (char*)&o) * 100000;
         }
         int fill(void) {
             struct Outer o;
             o.id = -3; o.inner.tag = 'x'; o.inner.weight = 2.5; o.i = 0x01020304; o.pair.a = 7; o.pair.b = 9;
             struct Outer copy = o;
             return copy.id + copy.inner.tag + (int)(copy.inner.weight * 2) + copy.bytes[0] + copy.bytes[3] * 10 + copy.pair.a * copy.pair.b;
         }
         unsigned float_bits(void) { union Bits b; b.f = 1.0f; return b.u; }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)layout());
  printf("%d\n", (int)fill());
  printf("%d\n", (int)float_bits());
  return 0;
}
