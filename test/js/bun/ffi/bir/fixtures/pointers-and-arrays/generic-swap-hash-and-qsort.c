void qsort(void *base, __SIZE_TYPE__ n, __SIZE_TYPE__ size, int (*cmp)(const void *, const void *));
         static void swap_bytes(void *a, void *b, unsigned long long size) {
             char *p = a, *q = b;
             while (size--) { char t = *p; *p++ = *q; *q++ = t; }
         }
         int swap_structs(void) {
             struct S { int a; double d; char tag; } x = { 1, 2.5, 'x' }, y = { 9, 7.5, 'y' };
             swap_bytes(&x, &y, sizeof x);
             return x.a * 100 + (int)(x.d * 2) + (x.tag == 'y') + (y.tag == 'x') + y.a * 1000;
         }
         unsigned fnv1a(const unsigned char *data, int len) {
             unsigned h = 2166136261u;
             for (int i = 0; i < len; i++) { h ^= data[i]; h *= 16777619u; }
             return h;
         }
         unsigned hash_hello(void) { return fnv1a((const unsigned char *)"hello", 5); }
         unsigned long long fnv64(const char *s) { unsigned long long h = 14695981039346656037ULL; while (*s) { h ^= (unsigned char)*s++; h *= 1099511628211ULL; } return h; }
         unsigned long long hash64(void) { return fnv64("hello"); }
         static int by_value(const void *a, const void *b) { int x = *(const int *)a, y = *(const int *)b; return (x > y) - (x < y); }
         int sorted(void) {
             int v[6] = { 5, -2, 9, 0, 3, 3 };
             qsort(v, 6, sizeof v[0], by_value);
             int ok = 1;
             for (int i = 1; i < 6; i++) ok = ok && v[i - 1] <= v[i];
             return ok * 1000 + v[0] * 10 + v[5];
         }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)swap_structs());
  printf("%d\n", (int)hash_hello());
  printf("%lld\n", (long long)hash64());
  printf("%d\n", (int)sorted());
  return 0;
}
