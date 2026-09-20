#include <stdarg.h>
        #include <stdio.h>
        #include <string.h>
        static char line[128];
        static int logf(const char *level, const char *fmt, ...) {
            va_list ap;
            va_start(ap, fmt);
            int n = snprintf(line, sizeof line, "[%s] ", level);
            n += vsnprintf(line + n, sizeof line - (size_t)n, fmt, ap);
            va_end(ap);
            return n;
        }
        int run(void) { int n = logf("info", "%s=%d (%.2f) %lu", "answer", 42, 0.5, 7ul); puts(line); return n + (int)strlen(line); }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)run());
  return 0;
}
