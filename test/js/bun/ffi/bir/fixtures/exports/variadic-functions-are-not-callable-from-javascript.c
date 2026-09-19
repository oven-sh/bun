// A variadic function is there for the rest of the C file, but JavaScript has no way to call it.
int v(int n, ...) { return n; }
int w(void) { return v(1, 2) + v(40); }
