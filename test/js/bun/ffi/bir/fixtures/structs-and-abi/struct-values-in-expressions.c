typedef struct { double x, y; } Vec2;
         typedef struct { Vec2 min, max; } Rect;
         typedef struct { int quot, rem; } Div;
         static Vec2 vec(double x, double y) { Vec2 v = { x, y }; return v; }
         static Vec2 add(Vec2 a, Vec2 b) { return vec(a.x + b.x, a.y + b.y); }
         static Vec2 scale(Vec2 a, double k) { a.x *= k; a.y *= k; return a; }
         static double dot(Vec2 a, Vec2 b) { return a.x * b.x + a.y * b.y; }
         static Rect bounds(Vec2 a, Vec2 b) { Rect r = { { a.x < b.x ? a.x : b.x, a.y < b.y ? a.y : b.y }, { a.x > b.x ? a.x : b.x, a.y > b.y ? a.y : b.y } }; return r; }
         static double area(Rect r) { Vec2 d = add(r.max, scale(r.min, -1)); return d.x * d.y; }
         double vector_math(void) { Vec2 a = vec(1, 2), b = vec(4, -2); return dot(add(a, b), scale(b, 0.5)) + area(bounds(a, b)) + add(a, b).x * 1000 + bounds(a, b).max.y * 100; }
         static Div divide(int n, int d) { return (Div){ n / d, n % d }; }
         int div_like(void) { Div r = divide(47, 5); return r.quot * 10 + r.rem + divide(9, 4).rem * 100; }
         static Vec2 pick(int first, Vec2 a, Vec2 b) { return first ? a : b; }
         double conditional(int c) { Vec2 a = vec(1, 2), b = vec(3, 4); Vec2 r = c ? add(a, b) : scale(a, 10); return pick(c, r, a).y + (c ? a : b).x * 100; }
         static Vec2 (*binary(int which))(Vec2, Vec2) { return which ? add : 0; }
         double through_pointers(void) { Vec2 (*f)(Vec2, double) = scale; Vec2 r = f(vec(2, 3), 2); return binary(1)(r, r).y + f(r, 0.5).x; }
         static double sum_nested(Rect r, Vec2 extra, int n) { return r.min.x + r.min.y + r.max.x + r.max.y + extra.x + extra.y + n; }
         double nested_by_value(void) { Rect r = { { 1, 2 }, { 3, 4 } }; return sum_nested(r, r.max, 5) + sum_nested(bounds(vec(0, 0), vec(9, 9)), vec(1, 1), 0); }
         double assign_forms(void) { Vec2 a, b; a = b = vec(5, 6); Vec2 c = add(a, b); Vec2 arr[2] = { add(a, a), vec(0, 1) }; a = arr[0]; return a.x + c.y + arr[1].y; }
         union Number { int i; float f; double d; };
         static union Number as_double(double d) { union Number n; n.d = d; return n; }
         static double read_double(union Number n) { return n.d; }
         double unions(void) { union Number n = as_double(2.5); return read_double(n) + read_double(as_double(0.25)); }
         struct Empty {};
         static struct Empty nothing(struct Empty e, int x) { (void)x; return e; }
         int empties(void) { struct Empty e; struct Empty r = nothing(e, 3); (void)r; return (int)sizeof(struct Empty) + 1; }

int printf(const char *, ...);
int main(void) {
  printf("%.17g\n", (double)vector_math());
  printf("%d\n", (int)div_like());
  printf("%.17g\n", (double)conditional(1));
  printf("%.17g\n", (double)conditional(0));
  printf("%.17g\n", (double)through_pointers());
  printf("%.17g\n", (double)nested_by_value());
  printf("%.17g\n", (double)assign_forms());
  printf("%.17g\n", (double)unions());
  printf("%d\n", (int)empties());
  return 0;
}
