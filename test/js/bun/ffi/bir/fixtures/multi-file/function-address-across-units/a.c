int twice(int); int (*stored)(int) = twice; int apply(int x) { int (*f)(int) = twice; return stored(x) + f(x); }
