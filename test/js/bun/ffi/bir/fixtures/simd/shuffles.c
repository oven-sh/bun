typedef int V __attribute__((vector_size(16)));
         typedef unsigned char B __attribute__((vector_size(16)));
         typedef float F __attribute__((vector_size(16)));
         V reverse(V a) { return __builtin_shufflevector(a, a, 3, 2, 1, 0); }
         V interleave_low(V a, V b) { return __builtin_shufflevector(a, b, 0, 4, 1, 5); }
         V interleave_high(V a, V b) { return __builtin_shufflevector(a, b, 2, 6, 3, 7); }
         V broadcast2(V a) { return __builtin_shufflevector(a, a, 2, 2, 2, 2); }
         V blend(V a, V b) { return __builtin_shufflevector(a, b, 0, 5, 2, 7); }
         V dont_care(V a, V b) { return __builtin_shufflevector(a, b, 7, -1, -1, 4); }
         B reverse_bytes(B a) { return __builtin_shufflevector(a, a, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0); }
         F rotate(F a) { return __builtin_shufflevector(a, a, 1, 2, 3, 0); }
         V gnu_one(V a) { V m = {3, 2, 1, 0}; return __builtin_shuffle(a, m); }
         V gnu_two(V a, V b) { return __builtin_shuffle(a, b, (V){0, 4, 9, 13}); }
         V gnu_variable(V a, V m) { return __builtin_shuffle(a, m); }
         V gnu_variable_two(V a, V b, V m) { return __builtin_shuffle(a, b, m); }
         B gnu_bytes(B a, B m) { return __builtin_shuffle(a, m); }

int printf(const char *, ...);
typedef unsigned char bun_test_bytes __attribute__((vector_size(16)));
static void bun_test_show(bun_test_bytes v) {
  for (int i = 0; i < 16; i++) printf(i ? " %02x" : "%02x", v[i]);
  printf("\n");
}
int main(void) {
  bun_test_show((bun_test_bytes)reverse((int __attribute__((vector_size(16))))(bun_test_bytes){1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 4, 0, 0, 0}));
  bun_test_show((bun_test_bytes)interleave_low((int __attribute__((vector_size(16))))(bun_test_bytes){1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 4, 0, 0, 0}, (int __attribute__((vector_size(16))))(bun_test_bytes){10, 0, 0, 0, 20, 0, 0, 0, 30, 0, 0, 0, 40, 0, 0, 0}));
  bun_test_show((bun_test_bytes)interleave_high((int __attribute__((vector_size(16))))(bun_test_bytes){1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 4, 0, 0, 0}, (int __attribute__((vector_size(16))))(bun_test_bytes){10, 0, 0, 0, 20, 0, 0, 0, 30, 0, 0, 0, 40, 0, 0, 0}));
  bun_test_show((bun_test_bytes)broadcast2((int __attribute__((vector_size(16))))(bun_test_bytes){1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 4, 0, 0, 0}));
  bun_test_show((bun_test_bytes)blend((int __attribute__((vector_size(16))))(bun_test_bytes){1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 4, 0, 0, 0}, (int __attribute__((vector_size(16))))(bun_test_bytes){10, 0, 0, 0, 20, 0, 0, 0, 30, 0, 0, 0, 40, 0, 0, 0}));
  { /* Lanes 1 and 2 may hold anything. */
    int __attribute__((vector_size(16))) loose = dont_care((int __attribute__((vector_size(16))))(bun_test_bytes){1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 4, 0, 0, 0}, (int __attribute__((vector_size(16))))(bun_test_bytes){10, 0, 0, 0, 20, 0, 0, 0, 30, 0, 0, 0, 40, 0, 0, 0});
    printf("%d %d\n", loose[0], loose[3]);
  }
  bun_test_show((bun_test_bytes)reverse_bytes((unsigned char __attribute__((vector_size(16))))(bun_test_bytes){0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 45}));
  bun_test_show((bun_test_bytes)rotate((float __attribute__((vector_size(16))))(bun_test_bytes){0, 0, 128, 63, 0, 0, 0, 64, 0, 0, 64, 64, 0, 0, 128, 64}));
  bun_test_show((bun_test_bytes)gnu_one((int __attribute__((vector_size(16))))(bun_test_bytes){1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 4, 0, 0, 0}));
  bun_test_show((bun_test_bytes)gnu_two((int __attribute__((vector_size(16))))(bun_test_bytes){1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 4, 0, 0, 0}, (int __attribute__((vector_size(16))))(bun_test_bytes){10, 0, 0, 0, 20, 0, 0, 0, 30, 0, 0, 0, 40, 0, 0, 0}));
  bun_test_show((bun_test_bytes)gnu_variable((int __attribute__((vector_size(16))))(bun_test_bytes){1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 4, 0, 0, 0}, (int __attribute__((vector_size(16))))(bun_test_bytes){2, 0, 0, 0, 2, 0, 0, 0, 7, 0, 0, 0, 0, 0, 0, 0}));
  bun_test_show((bun_test_bytes)gnu_variable_two((int __attribute__((vector_size(16))))(bun_test_bytes){1, 0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 4, 0, 0, 0}, (int __attribute__((vector_size(16))))(bun_test_bytes){10, 0, 0, 0, 20, 0, 0, 0, 30, 0, 0, 0, 40, 0, 0, 0}, (int __attribute__((vector_size(16))))(bun_test_bytes){7, 0, 0, 0, 0, 0, 0, 0, 12, 0, 0, 0, 1, 0, 0, 0}));
  bun_test_show((bun_test_bytes)gnu_bytes((unsigned char __attribute__((vector_size(16))))(bun_test_bytes){0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42, 45}, (unsigned char __attribute__((vector_size(16))))(bun_test_bytes){3, 10, 17, 24, 31, 6, 13, 20, 27, 2, 9, 16, 23, 30, 5, 12}));
  return 0;
}
