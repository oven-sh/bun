// Microsoft C's rule for `inline`: every file that uses an inline function has its own definition of it, whatever
// else the declarations say (`extern`, or a declaration without `inline`), and none of them is for anyone else:
// an importer gets the functions that are not inline.
static int used_transitively(int x) { return x * 3; }
static __inline int helper(int x) { return used_transitively(x) + 1; }
__inline int inline_only(int x) { return x + 7; }
extern __inline int extern_inline(int x) { return x + 8; }
__inline int declared_plain(int x) { return x + 9; }
int declared_plain(int x);
int run(int x) { return helper(x) + inline_only(x) + extern_inline(x) + declared_plain(x); }
