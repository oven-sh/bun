#define X 1
         #pragma push_macro("X")
         #undef X
         #define X 2
         int second = X;
         #pragma push_macro("X")
         #undef X
         int third =
         #ifdef X
           100;
         #else
           3;
         #endif
         #pragma pop_macro("X")
         int fourth = X;
         #pragma pop_macro("X")
         int fifth = X;
         #pragma pop_macro("X")
         int sixth = X;
         #pragma push_macro("NEVER")
         #define NEVER 1
         #pragma pop_macro("NEVER")
         #ifdef NEVER
         #error pop_macro must undefine a name that was not a macro
         #endif
         int sum(void) { return second * 1000 + third * 100 + fourth * 10 + fifth + sixth * 10000; }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)sum());
  return 0;
}
