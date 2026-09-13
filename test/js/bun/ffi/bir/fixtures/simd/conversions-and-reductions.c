typedef int V __attribute__((vector_size(16)));
         typedef unsigned U __attribute__((vector_size(16)));
         typedef float F __attribute__((vector_size(16)));
         typedef long long L __attribute__((vector_size(16)));
         typedef double D __attribute__((vector_size(16)));
         typedef unsigned char B __attribute__((vector_size(16)));
         typedef short H __attribute__((vector_size(16)));
         F to_float(V v) { return __builtin_convertvector(v, F); }
         F unsigned_to_float(U v) { return __builtin_convertvector(v, F); }
         V to_int(F v) { return __builtin_convertvector(v, V); }
         U to_unsigned(F v) { return __builtin_convertvector(v, U); }
         D long_to_double(L v) { return __builtin_convertvector(v, D); }
         L double_to_long(D v) { return __builtin_convertvector(v, L); }
         U same_width(V v) { return __builtin_convertvector(v, U); }
         F reinterpret(V v) { return (F)v; }
         int sum(V v) { return __builtin_reduce_add(v); }
         int product(V v) { return __builtin_reduce_mul(v); }
         int lowest(V v) { return __builtin_reduce_min(v); }
         unsigned highest(U v) { return __builtin_reduce_max(v); }
         int all_and(V v) { return __builtin_reduce_and(v); }
         int any_or(V v) { return __builtin_reduce_or(v); }
         int parity(V v) { return __builtin_reduce_xor(v); }
         int byte_sum(B v) { return __builtin_reduce_add(v); }
         int short_min(H v) { return __builtin_reduce_min(v); }
         float fsum(F v) { return __builtin_reduce_add(v); }
         double dmax(D v) { return __builtin_reduce_max(v); }
         long long lsum(L v) { return __builtin_reduce_add(v); }
         V absolute(V v) { return __builtin_elementwise_abs(v); }
         F fabsolute(F v) { return __builtin_elementwise_abs(v); }
         V smaller(V a, V b) { return __builtin_elementwise_min(a, b); }
         U ubigger(U a, U b) { return __builtin_elementwise_max(a, b); }
         F roots(F v) { return __builtin_elementwise_sqrt(v); }
         float manual_sum(F v) { F s = v + __builtin_shufflevector(v, v, 2, 3, 0, 1); s += __builtin_shufflevector(s, s, 1, 0, 3, 2); return s[0]; }

int printf(const char *, ...);
typedef unsigned char bun_test_bytes __attribute__((vector_size(16)));
static void bun_test_show(bun_test_bytes v) {
  for (int i = 0; i < 16; i++) printf(i ? " %02x" : "%02x", v[i]);
  printf("\n");
}
int main(void) {
  bun_test_show((bun_test_bytes)to_float((int __attribute__((vector_size(16))))(bun_test_bytes){1, 0, 0, 0, 254, 255, 255, 255, 44, 1, 0, 0, 0, 0, 0, 0}));
  bun_test_show((bun_test_bytes)unsigned_to_float((unsigned int __attribute__((vector_size(16))))(bun_test_bytes){255, 255, 255, 255, 2, 0, 0, 0, 0, 0, 0, 0, 7, 0, 0, 0}));
  bun_test_show((bun_test_bytes)to_int((float __attribute__((vector_size(16))))(bun_test_bytes){51, 51, 243, 63, 154, 153, 57, 192, 236, 120, 173, 96, 0, 0, 192, 127}));
  bun_test_show((bun_test_bytes)to_unsigned((float __attribute__((vector_size(16))))(bun_test_bytes){0, 0, 96, 64, 0, 0, 0, 192, 40, 107, 110, 79, 0, 0, 0, 0}));
  bun_test_show((bun_test_bytes)long_to_double((long long __attribute__((vector_size(16))))(bun_test_bytes){251, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 0, 0, 1, 0, 0}));
  bun_test_show((bun_test_bytes)double_to_long((double __attribute__((vector_size(16))))(bun_test_bytes){154, 153, 153, 153, 153, 153, 31, 192, 0, 0, 0, 162, 148, 26, 109, 66}));
  bun_test_show((bun_test_bytes)same_width((int __attribute__((vector_size(16))))(bun_test_bytes){255, 255, 255, 255, 2, 0, 0, 0, 3, 0, 0, 0, 4, 0, 0, 0}));
  bun_test_show((bun_test_bytes)reinterpret((int __attribute__((vector_size(16))))(bun_test_bytes){0, 0, 128, 63, 0, 0, 0, 0, 0, 0, 0, 64, 0, 0, 0, 0}));
  printf("%d\n", (int)sum((int __attribute__((vector_size(16))))(bun_test_bytes){3, 0, 0, 0, 252, 255, 255, 255, 5, 0, 0, 0, 6, 0, 0, 0}));
  printf("%d\n", (int)product((int __attribute__((vector_size(16))))(bun_test_bytes){3, 0, 0, 0, 252, 255, 255, 255, 5, 0, 0, 0, 6, 0, 0, 0}));
  printf("%d\n", (int)lowest((int __attribute__((vector_size(16))))(bun_test_bytes){3, 0, 0, 0, 252, 255, 255, 255, 5, 0, 0, 0, 6, 0, 0, 0}));
  printf("%d\n", (int)highest((unsigned int __attribute__((vector_size(16))))(bun_test_bytes){3, 0, 0, 0, 252, 255, 255, 255, 5, 0, 0, 0, 6, 0, 0, 0}));
  printf("%d\n", (int)all_and((int __attribute__((vector_size(16))))(bun_test_bytes){7, 0, 0, 0, 5, 0, 0, 0, 13, 0, 0, 0, 21, 0, 0, 0}));
  printf("%d\n", (int)any_or((int __attribute__((vector_size(16))))(bun_test_bytes){1, 0, 0, 0, 2, 0, 0, 0, 4, 0, 0, 0, 64, 0, 0, 0}));
  printf("%d\n", (int)parity((int __attribute__((vector_size(16))))(bun_test_bytes){1, 0, 0, 0, 3, 0, 0, 0, 7, 0, 0, 0, 15, 0, 0, 0}));
  printf("%d\n", (int)byte_sum((unsigned char __attribute__((vector_size(16))))(bun_test_bytes){250, 251, 252, 253, 254, 255, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9}));
  printf("%d\n", (int)short_min((short __attribute__((vector_size(16))))(bun_test_bytes){5, 0, 240, 255, 7, 0, 100, 0, 3, 0, 0, 128, 9, 0, 1, 0}));
  printf("%.9g\n", (double)fsum((float __attribute__((vector_size(16))))(bun_test_bytes){0, 0, 128, 63, 0, 0, 0, 64, 0, 0, 64, 64, 0, 0, 144, 64}));
  printf("%.9g\n", (double)manual_sum((float __attribute__((vector_size(16))))(bun_test_bytes){0, 0, 128, 63, 0, 0, 0, 64, 0, 0, 64, 64, 0, 0, 144, 64}));
  printf("%.17g\n", (double)dmax((double __attribute__((vector_size(16))))(bun_test_bytes){0, 0, 0, 0, 0, 0, 4, 64, 0, 0, 0, 0, 0, 0, 34, 192}));
  printf("%lld\n", (long long)lsum((long long __attribute__((vector_size(16))))(bun_test_bytes){0, 0, 0, 0, 0, 1, 0, 0, 5, 0, 0, 0, 0, 0, 0, 0}));
  bun_test_show((bun_test_bytes)absolute((int __attribute__((vector_size(16))))(bun_test_bytes){255, 255, 255, 255, 2, 0, 0, 0, 0, 0, 0, 128, 249, 255, 255, 255}));
  bun_test_show((bun_test_bytes)fabsolute((float __attribute__((vector_size(16))))(bun_test_bytes){0, 0, 128, 191, 0, 0, 0, 64, 0, 0, 0, 191, 0, 0, 0, 0}));
  bun_test_show((bun_test_bytes)smaller((int __attribute__((vector_size(16))))(bun_test_bytes){1, 0, 0, 0, 254, 255, 255, 255, 3, 0, 0, 0, 4, 0, 0, 0}, (int __attribute__((vector_size(16))))(bun_test_bytes){0, 0, 0, 0, 5, 0, 0, 0, 3, 0, 0, 0, 247, 255, 255, 255}));
  bun_test_show((bun_test_bytes)ubigger((unsigned int __attribute__((vector_size(16))))(bun_test_bytes){1, 0, 0, 0, 254, 255, 255, 255, 3, 0, 0, 0, 4, 0, 0, 0}, (unsigned int __attribute__((vector_size(16))))(bun_test_bytes){0, 0, 0, 0, 5, 0, 0, 0, 3, 0, 0, 0, 247, 255, 255, 255}));
  bun_test_show((bun_test_bytes)roots((float __attribute__((vector_size(16))))(bun_test_bytes){0, 0, 128, 64, 0, 0, 16, 65, 0, 0, 16, 64, 0, 0, 0, 0}));
  return 0;
}
