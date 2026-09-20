// A function that takes or returns a structure by value is for other C functions: JavaScript gets the ones
// whose arguments and results are numbers and pointers.
struct P { long long a, b; };
struct P make(long long a) { struct P p = {a, a + 1}; return p; }
long long sum(struct P p) { return p.a + p.b; }
long long use(long long x) { return sum(make(x)) + make(2).b; }
_Complex double rotate(_Complex double z) { return z * (__extension__ 1.0i); }
double real_of_rotated(double re, double im) { return __real__ rotate(__builtin_complex(re, im)); }
