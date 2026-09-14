// An alias with external linkage is one more name an importer can call; a static alias is not.
int calls;
int target(int x) { calls++; return x + 1; }
int also_target(int) __attribute__((alias("target")));
static int hidden(int) __attribute__((alias("target")));
int use(void) { return also_target(1) + hidden(2) + calls * 1000; }
