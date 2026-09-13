_Thread_local int counter = 5;
         static __thread long long big = -2;
         _Thread_local char name[8] = "tls";
         _Thread_local struct { short a; double b; } record = { 3, 1.5 };
         __thread int zeroed;
         int ordinary = 100;
         int bump(void) { counter += 2; zeroed++; return counter * 100 + zeroed; }
         long long wide(void) { return big-- + (long long)sizeof(big); }
         int text(int i) { name[3] = 'x'; return name[i]; }
         int fields(void) { record.a++; int *p = &counter; *p += 1; return record.a + (int)(record.b * 2) + *p * 10 + ordinary; }
         int per_function(void) { static _Thread_local int calls = 10; extern _Thread_local int counter; return ++calls + counter * 0; }
         int *address(void) { return &zeroed; }
         int different(void) { return (char *)&counter != (char *)&ordinary && address() == &zeroed; }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)bump());
  printf("%d\n", (int)bump());
  printf("%lld\n", (long long)wide());
  printf("%lld\n", (long long)wide());
  printf("%d\n", (int)text(1));
  printf("%d\n", (int)text(3));
  printf("%d\n", (int)fields());
  printf("%d\n", (int)per_function());
  printf("%d\n", (int)per_function());
  printf("%d\n", (int)different());
  return 0;
}
