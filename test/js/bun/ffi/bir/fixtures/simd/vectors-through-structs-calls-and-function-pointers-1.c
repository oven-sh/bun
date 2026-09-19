typedef float V __attribute__((vector_size(16)));
         typedef int I __attribute__((vector_size(16)));
         struct Particle { V position; V velocity; int id; };
         struct Wrapped { V v; };
         union Both { V v; float f[4]; };
         static V scale(V v, float k) { return v * k; }
         static struct Wrapped wrap(V v) { struct Wrapped w = { v + 1.0f }; return w; }
         static V unwrap(struct Wrapped w) { return w.v; }
         static struct Particle step(struct Particle p, float dt) { p.position += p.velocity * dt; p.id++; return p; }
         static float second(union Both b) { return b.f[1]; }
         static union Both splat(float x) { union Both b; b.v = (V){x, x, x, x}; return b; }
         typedef V (*binary)(V, V);
         static V add(V a, V b) { return a + b; }
         static V mul(V a, V b) { return a * b; }
         static binary table[2] = { add, mul };
         V apply(int which, V a, V b) { return table[which](a, b); }
         V chain(V v) { return unwrap(wrap(scale(v, 2.0f))); }
         V simulate(V position, V velocity, int steps) {
             struct Particle p = { position, velocity, 0 };
             for (int i = 0; i < steps; i++) p = step(p, 0.5f);
             return p.position + (float)p.id;
         }
         float unions(float x) { return second(splat(x)) + second((union Both){ .f = {1, x, 3, 4} }); }
         I many(I a, I b, I c, I d, I e, I f, I g, I h, I i, I j) { return a + b + c + d + e + f + g + h + i - j; }
         I call_many(I base) { return many(base, base + 1, base + 2, base + 3, base + 4, base + 5, base + 6, base + 7, base + 8, base + 9); }
         struct Wrapped global_particle = { {1, 2, 3, 4} };
         V read_global(void) { return global_particle.v; }

int printf(const char *, ...);
typedef unsigned char bun_test_bytes __attribute__((vector_size(16)));
static void bun_test_show(bun_test_bytes v) {
  for (int i = 0; i < 16; i++) printf(i ? " %02x" : "%02x", v[i]);
  printf("\n");
}
int main(void) {
  bun_test_show((bun_test_bytes)apply(0, (float __attribute__((vector_size(16))))(bun_test_bytes){0, 0, 128, 63, 0, 0, 0, 64, 0, 0, 64, 64, 0, 0, 128, 64}, (float __attribute__((vector_size(16))))(bun_test_bytes){0, 0, 0, 63, 0, 0, 0, 63, 0, 0, 0, 64, 0, 0, 128, 191}));
  bun_test_show((bun_test_bytes)apply(1, (float __attribute__((vector_size(16))))(bun_test_bytes){0, 0, 128, 63, 0, 0, 0, 64, 0, 0, 64, 64, 0, 0, 128, 64}, (float __attribute__((vector_size(16))))(bun_test_bytes){0, 0, 0, 63, 0, 0, 0, 63, 0, 0, 0, 64, 0, 0, 128, 191}));
  bun_test_show((bun_test_bytes)chain((float __attribute__((vector_size(16))))(bun_test_bytes){0, 0, 128, 63, 0, 0, 0, 64, 0, 0, 64, 64, 0, 0, 128, 64}));
  bun_test_show((bun_test_bytes)simulate((float __attribute__((vector_size(16))))(bun_test_bytes){0, 0, 128, 63, 0, 0, 0, 64, 0, 0, 64, 64, 0, 0, 128, 64}, (float __attribute__((vector_size(16))))(bun_test_bytes){0, 0, 0, 63, 0, 0, 0, 63, 0, 0, 0, 64, 0, 0, 128, 191}, 4));
  printf("%.9g\n", (double)unions(0x1.4000000000000p+1f));
  bun_test_show((bun_test_bytes)call_many((int __attribute__((vector_size(16))))(bun_test_bytes){1, 0, 0, 0, 10, 0, 0, 0, 100, 0, 0, 0, 232, 3, 0, 0}));
  bun_test_show((bun_test_bytes)read_global());
  return 0;
}
