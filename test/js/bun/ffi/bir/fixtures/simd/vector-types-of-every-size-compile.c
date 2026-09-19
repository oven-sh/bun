typedef float v2f __attribute__((vector_size(8)));
         typedef int v8i __attribute__((vector_size(32)));
         typedef float v16f __attribute__((__vector_size__(64)));
         typedef short s2 __attribute__((ext_vector_type(2)));
         typedef float float4 __attribute__((ext_vector_type(4)));
         v2f declared_only(v2f);
         float first(float4 v) { return v[0] + sizeof(v2f) + sizeof(v8i); }

int printf(const char *, ...);
int main(void) {

  return 0;
}
