// C11 6.7.9p21: what a brace list does not name is initialized as a static object would be,
// whatever the type of the first element and whatever was on the stack before.
#include <stdio.h>
#include <string.h>

typedef __int128 i128;
typedef unsigned __int128 u128;
struct P { int x, y; };
struct W { struct P p; int k; int arr[4]; };
struct Tail { int k; int arr[2]; struct P last; };

static __attribute__((noinline)) void dirty(void) {
  volatile unsigned char bytes[4096];
  memset((void *)bytes, 0xAB, sizeof bytes);
}

static void wide(u128 v) { printf(" %llx:%llx", (unsigned long long)(v >> 64), (unsigned long long)v); }
static void real(long double v) { printf(" %g", (double)v); }
static void pair(double _Complex v) { printf(" %g%+gi", __real__ v, __imag__ v); }
static void ints(const int *p, int n) { for (int i = 0; i < n; i++) printf(" %d", p[i]); }
static void whole(const struct W *w) { printf(" %d %d %d", w->p.x, w->p.y, w->k); ints(w->arr, 4); }

static struct P make(void) { struct P p = { 3, 4 }; return p; }

#define SHAPE(name) static __attribute__((noinline)) void name(void)
#define EACH(a, show) for (unsigned i = 0; i < sizeof a / sizeof a[0]; i++) show(a[i])

SHAPE(zero_i128) { i128 a[4] = { 0 }; EACH(a, wide); }
SHAPE(zero_u128) { u128 a[4] = { 0 }; EACH(a, wide); }
SHAPE(zero_long_double) { long double a[4] = { 0 }; EACH(a, real); }
SHAPE(zero_float_complex) { float _Complex a[4] = { 0 }; EACH(a, pair); }
SHAPE(zero_double_complex) { double _Complex a[4] = { 0 }; EACH(a, pair); }
SHAPE(value_i128) { i128 n = -5; i128 a[3] = { n }; EACH(a, wide); }
SHAPE(value_u128) { u128 n = (u128)7 << 70; u128 a[3] = { n }; EACH(a, wide); }
SHAPE(value_long_double) { long double n = 2.5L; long double a[3] = { n }; EACH(a, real); }
SHAPE(value_float_complex) { float _Complex n = 1.0f + 2.0fi; float _Complex a[3] = { n }; EACH(a, pair); }
SHAPE(value_double_complex) { double _Complex n = 1.0 + 2.0i; double _Complex a[3] = { n }; EACH(a, pair); }
SHAPE(designated_element) { i128 a[4] = { [2] = 9 }; EACH(a, wide); }
SHAPE(two_dimensions) { u128 m[2][2] = { { 0 } }; wide(m[0][0]); wide(m[0][1]); wide(m[1][0]); wide(m[1][1]); }
SHAPE(two_dimensions_second_row) { long double m[2][2] = { { 1 }, { 2 } }; real(m[0][0]); real(m[0][1]); real(m[1][0]); real(m[1][1]); }

SHAPE(struct_first_i128) { struct { i128 v; int k; int arr[3]; } s = { 0 }; wide(s.v); printf(" %d", s.k); ints(s.arr, 3); }
SHAPE(struct_first_long_double) { struct { long double v; int k; int arr[3]; } s = { 0 }; real(s.v); printf(" %d", s.k); ints(s.arr, 3); }
SHAPE(struct_first_complex) { struct { double _Complex v; int k; int arr[3]; } s = { 0 }; pair(s.v); printf(" %d", s.k); ints(s.arr, 3); }
SHAPE(struct_first_float_complex) { struct { float _Complex v; int k; int arr[3]; } s = { 1.5f }; pair(s.v); printf(" %d", s.k); ints(s.arr, 3); }
SHAPE(struct_value_i128) { i128 n = 11; struct { i128 v; int k; } s = { n }; wide(s.v); printf(" %d", s.k); }
SHAPE(struct_value_long_double) { struct { long double v; int k; } s = { 2.5L }; real(s.v); printf(" %d", s.k); }
SHAPE(struct_value_complex) { struct { double _Complex v; int k; } s = { 1.0 + 2.0i }; pair(s.v); printf(" %d", s.k); }
SHAPE(union_first_i128) { union { i128 v; int arr[8]; } u = { 0 }; ints(u.arr, 4); }
SHAPE(union_smaller_struct_first) { union { struct P p; int arr[6]; } u = { make() }; ints(u.arr, 2); }

SHAPE(struct_covers_first_member) { struct P src = { 3, 4 }; struct W w = { src }; whole(&w); }
SHAPE(struct_designates_first_member) { struct P src = { 3, 4 }; struct W w = { .p = src }; whole(&w); }
SHAPE(struct_from_a_call) { struct W w = { make() }; whole(&w); }
SHAPE(struct_designates_last_member) {
  struct P src = { 3, 4 };
  struct Tail t = { .last = src };
  printf(" %d", t.k); ints(t.arr, 2); printf(" %d %d", t.last.x, t.last.y);
}
SHAPE(struct_then_more) { struct P src = { 3, 4 }; struct W w = { src, 5, { 6 } }; whole(&w); }
SHAPE(array_of_structs) { struct P src = { 3, 4 }; struct W a[2] = { { src } }; whole(&a[0]); whole(&a[1]); }
SHAPE(array_of_structs_elided) { struct P src = { 3, 4 }; struct P a[3] = { src }; ints(&a[0].x, 6); }
SHAPE(array_of_structs_second) { struct P src = { 3, 4 }; struct P a[3] = { [1] = src }; ints(&a[0].x, 6); }

SHAPE(literal_i128) { i128 *a = (i128[4]){ 0 }; wide(a[0]); wide(a[1]); wide(a[2]); wide(a[3]); }
SHAPE(literal_long_double) { long double *a = (long double[3]){ 2.5L }; real(a[0]); real(a[1]); real(a[2]); }
SHAPE(literal_complex) { double _Complex *a = (double _Complex[3]){ 1.0 + 2.0i }; pair(a[0]); pair(a[1]); pair(a[2]); }
SHAPE(literal_struct_covers_first) { struct P src = { 3, 4 }; whole(&(struct W){ src }); }
SHAPE(literal_struct_designates_first) { struct P src = { 3, 4 }; whole(&(struct W){ .p = src }); }
SHAPE(literal_struct_from_a_call) { whole(&(struct W){ make() }); }
SHAPE(literal_struct_first_long_double) { struct L { long double v; int k; int arr[3]; } *s = &(struct L){ 0 }; real(s->v); printf(" %d", s->k); ints(s->arr, 3); }

// The one case that is a single copy: the initializer is the whole object.
SHAPE(whole_struct) { struct P src = { 3, 4 }; struct P q = src; struct W w = { src, 5, { 6, 7, 8, 9 } }; struct W copy = w; ints(&q.x, 2); whole(&copy); }
SHAPE(whole_struct_from_a_literal) { struct W w = (struct W){ { 3, 4 }, 5, { 6 } }; struct P q = make(); whole(&w); ints(&q.x, 2); }
SHAPE(scalars_in_braces) { i128 n = { 5 }; long double d = { 2.5L }; double _Complex z = { 1.0 + 2.0i }; wide(n); real(d); pair(z); }

#define RUN(name) dirty(); printf(#name ":"); name(); printf("\n")

int main(void) {
  RUN(zero_i128);
  RUN(zero_u128);
  RUN(zero_long_double);
  RUN(zero_float_complex);
  RUN(zero_double_complex);
  RUN(value_i128);
  RUN(value_u128);
  RUN(value_long_double);
  RUN(value_float_complex);
  RUN(value_double_complex);
  RUN(designated_element);
  RUN(two_dimensions);
  RUN(two_dimensions_second_row);
  RUN(struct_first_i128);
  RUN(struct_first_long_double);
  RUN(struct_first_complex);
  RUN(struct_first_float_complex);
  RUN(struct_value_i128);
  RUN(struct_value_long_double);
  RUN(struct_value_complex);
  RUN(union_first_i128);
  RUN(union_smaller_struct_first);
  RUN(struct_covers_first_member);
  RUN(struct_designates_first_member);
  RUN(struct_from_a_call);
  RUN(struct_designates_last_member);
  RUN(struct_then_more);
  RUN(array_of_structs);
  RUN(array_of_structs_elided);
  RUN(array_of_structs_second);
  RUN(literal_i128);
  RUN(literal_long_double);
  RUN(literal_complex);
  RUN(literal_struct_covers_first);
  RUN(literal_struct_designates_first);
  RUN(literal_struct_from_a_call);
  RUN(literal_struct_first_long_double);
  RUN(whole_struct);
  RUN(whole_struct_from_a_literal);
  RUN(scalars_in_braces);
  return 0;
}
