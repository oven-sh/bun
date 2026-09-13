// An alias with external linkage is one more name an importer can call; a static alias is not. A `gnu_inline`
// function that is `extern inline` is only ever inlined, so it gives the importer nothing; without `extern` it is
// an ordinary definition.
int calls;
int target(int x) { calls++; return x + 1; }
int also_target(int) __attribute__((alias("target")));
static int hidden(int) __attribute__((alias("target")));
extern double my_atof(const char *);
extern __inline __attribute__((__gnu_inline__)) double my_atof(const char *s) { return s[0] - '0'; }
__inline __attribute__((__gnu_inline__)) int emitted(int x) { return x + 1; }
int use(void) { return also_target(1) + hidden(2) + (int)my_atof("7") + emitted(1) + calls * 1000; }
