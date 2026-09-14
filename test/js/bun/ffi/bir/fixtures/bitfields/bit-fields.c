struct Flags { unsigned a : 1; unsigned b : 3; int c : 4; unsigned : 0; unsigned d : 9; _Bool e : 1; long long big : 40; };
         struct Mixed { char tag; int x : 5; int y : 11; short s; unsigned z : 17; };
         struct Packed { unsigned a : 3, b : 5, c : 8; } __attribute__((packed));
         static struct Flags g = { 1, 5, -3, 300, 1, -2 };
         static struct Flags g2 = { .d = 511, .c = 7 };
         int layout(void) { return sizeof(struct Flags) * 10000 + sizeof(struct Mixed) * 100 + sizeof(struct Packed); }
         int read_static(void) { return g.a + g.b * 10 + g.c * 100 + g.d * 1000 + g.e * 1000000 + (int)g.big * 10000000 + g2.d + g2.c; }
         int write(int v) {
             struct Flags f = { 0 };
             f.a = v; f.b = v; f.c = v; f.d = v; f.e = v; f.big = -1;
             f.b += 1; f.c--; ++f.d;
             return f.a + f.b * 10 + f.c * 100 + f.d * 1000 + f.e * 1000000 + (f.big == -1) * 10000000;
         }
         int neighbours(void) { struct Mixed m = { 'q', -1, 1023, -5, 70000 }; m.x = 3; m.z = 99999; return m.tag + m.x + m.y + m.s + (int)m.z; }
         int value_of_assignment(void) { struct Flags f; int r = (f.b = 13); int s = (f.c = 9); return r * 100 + s; }
         int promotes(void) { struct Flags f; f.b = 1; f.d = 1; return (f.b - 2 < 0) + (f.d - 2 < 0) + (sizeof(f.b + 0) == 4); }
         unsigned char raw(void) { union { struct Packed p; unsigned char bytes[2]; } u = { { 5, 9, 0xab } }; return u.bytes[0]; }
         int through_pointer(struct Flags *p) { p->d = 77; p->a ^= 1; return p->d + p->a; }
         int local_designated(void) { struct Flags f = { .c = -8, .a = 1, .big = 1LL << 38 }; return f.c + f.a + (int)(f.big >> 38) * 100; }
         int call_through(void) { struct Flags f = { 0 }; return through_pointer(&f); }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)layout());
  printf("%d\n", (int)read_static());
  printf("%d\n", (int)write(5));
  printf("%d\n", (int)write(8));
  printf("%d\n", (int)neighbours());
  printf("%d\n", (int)value_of_assignment());
  printf("%d\n", (int)promotes());
  printf("%d\n", (int)raw());
  printf("%d\n", (int)call_through());
  printf("%d\n", (int)local_designated());
  return 0;
}
