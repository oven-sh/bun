#include <stdarg.h>
         int vprintf(const char *, va_list); int vsnprintf(char *, unsigned long, const char *, va_list);
         static char text[64];
         void both(const char *fmt, ...) { va_list args; va_start(args, fmt); vprintf(fmt, args); va_end(args);
             va_start(args, fmt); vsnprintf(text, sizeof text, fmt, args); va_end(args); }
         int run(void) { both("%s %.2f %d %ld %c|", "string", 1.23, 456, 1234567891234L, 'x'); return text[0]; }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)run());
  return 0;
}
