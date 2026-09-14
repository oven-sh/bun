// C11 7.21 <stdio.h>: every conversion of the printf and scanf families, the va_list forms, and reading a file
// (this one) through a stream.
#include <stdarg.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>

static int format(char *out, size_t size, const char *how, ...) {
  va_list ap, copy;
  va_start(ap, how);
  va_copy(copy, ap);
  int needed = vsnprintf(0, 0, how, copy);          // the length without writing anything
  va_end(copy);
  int written = vsnprintf(out, size, how, ap);
  va_end(ap);
  return needed == written ? written : -1;
}
static int scan(const char *text, const char *how, ...) {
  va_list ap;
  va_start(ap, how);
  int matched = vsscanf(text, how, ap);
  va_end(ap);
  return matched;
}

int main(void) {
  char line[256];
  // Integers: every length modifier, flag, width and precision.
  snprintf(line, sizeof line, "%d|%i|%u|%o|%x|%X|%c|%%", -42, 42, 42u, 8u, 255u, 255u, 'c');
  printf("%s\n", line);
  snprintf(line, sizeof line, "%hhd|%hd|%ld|%lld|%jd|%zu|%td", (signed char)-1, (short)-2, -3L, -4LL, (intmax_t)-5, sizeof(int), (char *)8 - (char *)3);
  printf("%s\n", line);
  snprintf(line, sizeof line, "%5d|%-5d|%05d|%+d|% d|%#x|%#o|%.3d|%8.3d|%*d|%-*d|%.*d", 42, 42, 42, 42, 42, 255u, 8u, 7, 7, 4, 7, 4, 7, 3, 7);
  printf("%s\n", line);
  snprintf(line, sizeof line, "%hhu|%hu|%lu|%llu|%llx", (unsigned char)255, (unsigned short)65535, 4294967295UL, 18446744073709551615ULL, 0xdeadbeefcafeULL);
  printf("%s\n", line);
  // Floating: f e g a, their capitals, long double.
  snprintf(line, sizeof line, "%f|%.2f|%e|%.3E|%g|%G|%10.4f|%-10.2e|%+.1f|%.0f|%#.0f", 3.14159, 2.71828, 12345.678, 0.00012, 0.0001, 1e20, 3.14159, 31415.9, 2.0, 2.5, 3.0);
  printf("%s\n", line);
  snprintf(line, sizeof line, "%a|%A|%.1a|%Lf|%Le|%Lg", 1.0, 0.5, 1.0, 1.5L, 1500.0L, 0.25L);
  printf("%s\n", line);
  // Strings and pointers. (%n is in a fixture of its own: Microsoft's library refuses it unless asked.)
  snprintf(line, sizeof line, "%s|%10s|%-10s|%.3s|%.*s|%c", "text", "right", "left", "truncated", 2, "abc", 'z');
  printf("%s\n", line);
  snprintf(line, sizeof line, "%p", (void *)line);
  printf("%d\n", strlen(line) > 0);
  // The return value, truncation, and the va_list forms.
  printf("%d %d %s\n", snprintf(line, 4, "%s", "abcdefgh"), snprintf(0, 0, "%d", 123456), line);
  printf("%d %s\n", format(line, sizeof line, "%d-%s-%.1f", 7, "seven", 7.0), line);
  // scanf conversions.
  int d, i, n; unsigned u, x, o; char c, word[16], set[16]; float f; double lf; long long ll; short h;
  int matched = sscanf("-12 0x1f 99 ff 17 q hello abc 1.5 2.25 -9000000000 -3", "%d %i %u %x %o %c %15s %[a-c]%n %f %lf %lld %hd", &d, &i, &u, &x, &o, &c, word, set, &n, &f, &lf, &ll, &h);
  printf("%d: %d %d %u %u %u %c %s %s %d %.1f %.2f %lld %d\n", matched, d, i, u, x, o, c, word, set, n, (double)f, lf, ll, h);
  printf("%d %d %d\n", sscanf("12abc", "%d%*[a-z]%d", &d, &i), sscanf("", "%d", &d), scan("3,4", "%d,%d", &d, &i) + d + i);
  // A stream: this source file, read line by line, with seeking, pushing back and the end-of-file indicator.
  FILE *self = fopen(__FILE__, "rb");
  printf("%d\n", self != 0);
  if (self) {
    fgets(line, sizeof line, self);
    printf("%.12s\n", line);
    long after_first_line = ftell(self);
    int first = fgetc(self);
    ungetc(first, self);
    int again = fgetc(self);
    printf("%d %d\n", first == again, after_first_line > 12);
    fseek(self, 0, SEEK_END);
    long size = ftell(self);
    rewind(self);
    size_t total = 0, got;
    while ((got = fread(line, 1, sizeof line, self)) > 0) total += got;
    printf("%d %d %d\n", (long)total == size, feof(self) != 0, ferror(self) == 0);
    clearerr(self);
    int cleared = feof(self) == 0;
    printf("%d %d\n", cleared, fclose(self));
  }
  fprintf(stdout, "%s %d\n", "to stdout by name", fputs("", stdout) >= 0);
  putchar('o'); putc('k', stdout); puts("");
  printf("%d %d %d\n", EOF < 0, BUFSIZ >= 256, FILENAME_MAX > 0 && FOPEN_MAX >= 8 && L_tmpnam > 0);
  return 0;
}
