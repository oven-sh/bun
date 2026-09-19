// C11 6.7.2.1: members of every kind: nested, anonymous, arrays, flexible array members, and bit-fields of every
// type and width (what they hold, how they promote, how they wrap; not where a platform puts them).
#include <limits.h>
#include <stddef.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

struct point { int x, y; };
struct nested { struct point from, to; struct { int width, height; } size; union { int whole; short halves[2]; } value; };
struct anonymous { int kind; union { int integer; double real; struct { char first, second; }; }; struct { int a; }; };
struct flexible { int count; double values[]; };
struct self { struct self *next; int value; };
union overlay { unsigned whole; unsigned char bytes[sizeof(unsigned)]; float real; };

struct fields {
  unsigned one : 1; unsigned three : 3; unsigned full : 32; int negative : 5; signed int explicitly_signed : 2;
  _Bool flag : 1; unsigned : 0; unsigned after_break : 4; unsigned : 3; unsigned char small : 3; long long wide : 40; unsigned long long wider : 64;
};
enum color { RED, GREEN, BLUE };
struct enumerated { enum color c : 3; unsigned short s : 9; };

int main(void) {
  // Members come in the order declared, at increasing addresses, the first at the structure's own address.
  struct nested n = {{1, 2}, {3, 4}, {5, 6}, {.whole = 0x00020001}};
  printf("%d %d %d %d\n", offsetof(struct nested, from) == 0, offsetof(struct nested, to) > offsetof(struct nested, from), (void *)&n == (void *)&n.from.x, n.size.height + n.to.x);
  printf("%d %d\n", n.value.halves[0] + n.value.halves[1], sizeof(n.value) == sizeof(int));
  // The members of an anonymous structure or union are members of what contains it.
  struct anonymous a = {.kind = 1, .real = 2.5, .a = 9};
  a.first = 'x';
  printf("%d %c %d %d %d\n", a.kind, a.first, a.a, offsetof(struct anonymous, integer) == offsetof(struct anonymous, real), offsetof(struct anonymous, second) == offsetof(struct anonymous, first) + 1);
  // A flexible array member takes no room of its own and as much as was allocated.
  struct flexible *f = malloc(sizeof *f + 3 * sizeof f->values[0]);
  f->count = 3;
  for (int i = 0; i < f->count; i++) f->values[i] = i * 1.5;
  printf("%d %.1f %d\n", sizeof(struct flexible) == offsetof(struct flexible, values), f->values[2], (int)(sizeof(struct flexible) % _Alignof(double)));
  struct flexible copied = *f;     // copies only what sizeof covers
  printf("%d\n", copied.count);
  free(f);
  // A structure may hold a pointer to its own type; a union's members share their first bytes.
  struct self tail = {0, 1}, head = {&tail, 2};
  union overlay o = {.real = 1.0f};
  printf("%d %08x %d\n", head.next->value, o.whole, o.bytes[0] + o.bytes[1] + o.bytes[2] + o.bytes[3] == 0x3f + 0x80);
  // Bit-fields hold exactly their width: unsigned ones wrap, signed ones sign-extend, _Bool ones are 0 or 1.
  struct fields b;
  memset(&b, 0xff, sizeof b);
  printf("%d %d %d %d %d %d %d %d %lld %d\n", b.one, b.three, b.full == UINT_MAX, b.negative, b.explicitly_signed, b.flag, b.after_break, b.small, (long long)b.wide, b.wider == ULLONG_MAX);
  memset(&b, 0, sizeof b);
  b.one = 3; b.three = 9; b.negative = 15; b.negative++; b.explicitly_signed = 1; b.flag = 2; b.after_break = 0x1f; b.small = 7; b.small++;
  b.wide = (1LL << 39) - 1; b.wide++; b.wider = ULLONG_MAX; b.wider++;
  printf("%d %d %d %d %d %d %d %lld %llu\n", b.one, b.three, b.negative, b.explicitly_signed, b.flag, b.after_break, b.small, (long long)b.wide, (unsigned long long)b.wider);
  // Assignment yields the stored value; compound assignment and ++ work on the field alone; neighbours are untouched.
  b.full = 0x12345678;
  int stored = (b.three = 12);
  b.three += 3; b.three <<= 1;
  printf("%d %d %x %d\n", stored, b.three, (unsigned)b.full, b.one);
  // A bit-field whose values all fit in int promotes to int, so comparisons with negatives behave; one that does not, does not.
  b.three = 1; b.full = 1;
  printf("%d %d %d %d\n", b.three - 2 < 0, b.full - 2 < 0, -b.three, sizeof(+b.small) == sizeof(int));
  // Enumerated and narrow declared types are allowed too.
  struct enumerated e = {BLUE, 300};
  e.s += 300;
  printf("%d %d %d\n", e.c == BLUE, e.s, (int)e.c);
  // Structures are assigned, passed, returned and compared member by member; padding does not matter.
  struct nested m = n;
  m.to.y = 40;
  printf("%d %d %d\n", n.to.y, m.to.y, memcmp(&m.from, &n.from, sizeof m.from));
  return 0;
}
