// A `gnu_inline` function that is `extern inline` is only ever inlined, so it gives the importer nothing; without
// `extern` it is an ordinary definition. (What glibc's headers do when the compiler says it is GCC and optimizes.)
extern double my_atof(const char *);
extern __inline __attribute__((__gnu_inline__)) double my_atof(const char *s) { return s[0] - '0'; }
__inline __attribute__((__gnu_inline__)) int emitted(int x) { return x + 1; }
int use(void) { return (int)my_atof("7") + emitted(1); }
