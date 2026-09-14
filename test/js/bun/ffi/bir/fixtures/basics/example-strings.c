// Pointers into string literals and caller-provided buffers.

static const char *const weekdays[] = { "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun" };

int my_strlen(const char *s) {
    int n = 0;
    while (*s++) n++;
    return n;
}

const char *weekday(int i) {
    return weekdays[(unsigned)i % 7];
}

int hello_length(void) {
    return my_strlen("hello, " "world");
}

unsigned fnv1a(const unsigned char *data, int len) {
    unsigned h = 2166136261u;
    for (int i = 0; i < len; i++) {
        h ^= data[i];
        h *= 16777619u;
    }
    return h;
}

unsigned hash_weekday(int i) {
    const char *s = weekday(i);
    return fnv1a((const unsigned char *)s, my_strlen(s));
}

// Upper-cases `s` in place and returns how many bytes changed.
int to_upper(char *s) {
    int changed = 0;
    for (; *s; s++) {
        if (*s >= 'a' && *s <= 'z') {
            *s -= 'a' - 'A';
            changed++;
        }
    }
    return changed;
}

// Writes the decimal digits of `v` into `out` (NUL terminated); returns the length.
int format_int(int v, char *out) {
    char tmp[12];
    int n = 0, len = 0;
    unsigned u = v < 0 ? 0u - (unsigned)v : (unsigned)v;
    do { tmp[n++] = '0' + u % 10; u /= 10; } while (u);
    if (v < 0) out[len++] = '-';
    while (n) out[len++] = tmp[--n];
    out[len] = 0;
    return len;
}

int printf(const char *, ...);
static void bun_test_fill(unsigned char *to, const unsigned char *from, int n) {
  for (int i = 0; i < n; i++) to[i] = from[i];
}
static void bun_test_dump(const char *name, const unsigned char *p, int n) {
  printf("%s:", name);
  for (int i = 0; i < n; i++) printf(" %02x", p[i]);
  printf("\n");
}
static unsigned char buffer1[32] __attribute__((aligned(16)));
static unsigned char buffer2[16] __attribute__((aligned(16)));
int main(void) {
  printf("%s\n", (const char *)weekday(9));
  printf("%d\n", (int)hello_length());
  printf("%d\n", (int)hash_weekday(2));
  bun_test_fill(buffer1, (const unsigned char[]){72, 101, 108, 108, 111, 44, 32, 87, 111, 114, 108, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0}, 32);
  printf("%d\n", (int)to_upper((void *)buffer1));
  bun_test_dump("buffer1", buffer1, 32);
  for (int i = 0; i < 16; i++) buffer2[i] = 0;
  printf("%d\n", (int)format_int(-12345, (void *)buffer2));
  bun_test_dump("buffer2", buffer2, 16);
  printf("%d\n", (int)format_int((-2147483647 - 1), (void *)buffer2));
  bun_test_dump("buffer2", buffer2, 16);
  return 0;
}
