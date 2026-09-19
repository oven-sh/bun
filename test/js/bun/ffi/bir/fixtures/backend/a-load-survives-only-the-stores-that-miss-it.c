// A value loaded from memory may be kept across a store only if the store cannot have written those bytes: a store
// to a neighbouring field through the same pointer, or into another local, leaves it alone; a store that overlaps it
// in any geometry, through any other pointer to the same bytes, a volatile or atomic access, a fence or a call
// does not. Every load here is checked against what plain C says it must see.
#include <stdio.h>
#include <string.h>

#define NOINLINE __attribute__((noinline))
static int checks, wrong;
#define CHECK(c) do { int holds = (c) ? 1 : 0; checks++; wrong += !holds; printf("%s => %d\n", #c, holds); } while (0)

typedef int vector4 __attribute__((vector_size(16)));
struct record { int a; int b; long long wide; short halves[4]; unsigned char bytes[8]; double real; unsigned low : 5; unsigned high : 11; int after_bits; };
union pun { long long whole; int words[2]; short halves[4]; unsigned char bytes[8]; double real; };
struct holds_vector { int before; int pad[3]; vector4 lanes; int after; };

// A neighbouring field through the same pointer: the first load may be reused, and must equal a fresh one.
static NOINLINE int neighbours(struct record *r) {
  int first = r->a;
  r->b = first + 100;
  r->wide = 7;
  r->halves[0] = 9;
  return first + r->a;
}
// Every geometry of overlap with an 8-byte load at `wide`.
static NOINLINE long long same_offset_narrower(union pun *p) { long long before = p->whole; p->words[0] = 0x11111111; return before ^ p->whole; }
static NOINLINE long long upper_half(union pun *p) { long long before = p->whole; p->words[1] = 0x22222222; return before ^ p->whole; }
static NOINLINE long long one_byte_in_the_middle(union pun *p) { long long before = p->whole; p->bytes[3] = 0x33; return before ^ p->whole; }
static NOINLINE long long first_byte(union pun *p) { long long before = p->whole; p->bytes[0] = 0x44; return before ^ p->whole; }
static NOINLINE long long last_byte(union pun *p) { long long before = p->whole; p->bytes[7] = 0x55; return before ^ p->whole; }
static NOINLINE int wider_over_narrower(union pun *p) { int before = p->words[1]; p->whole = 0x6666666677777777LL; return before ^ p->words[1]; }
static NOINLINE int half_inside_word(union pun *p) { int before = p->words[0]; p->halves[1] = (short)0x8888; return before ^ p->words[0]; }
static NOINLINE double integer_over_double(union pun *p) { double before = p->real; p->whole = 0x4008000000000000LL; return before + p->real; }
// Overlap by exactly one byte at either end, which only byte arithmetic can express.
static NOINLINE int one_byte_overlap_at_the_end(unsigned char *base) {
  int before; memcpy(&before, base + 4, 4);
  short store = 0x0102; memcpy(base + 7, &store, 2);         // writes bytes 7 and 8: byte 7 is the load's last
  int after; memcpy(&after, base + 4, 4);
  return before ^ after;
}
static NOINLINE int one_byte_overlap_at_the_start(unsigned char *base) {
  int before; memcpy(&before, base + 4, 4);
  short store = 0x0304; memcpy(base + 3, &store, 2);         // writes bytes 3 and 4: byte 4 is the load's first
  int after; memcpy(&after, base + 4, 4);
  return before ^ after;
}
static NOINLINE int just_misses_on_both_sides(unsigned char *base) {
  int before; memcpy(&before, base + 4, 4);
  short store = 0x0506; memcpy(base + 2, &store, 2); memcpy(base + 8, &store, 2);
  int after; memcpy(&after, base + 4, 4);
  return before ^ after;
}
// A 16-byte vector store over a 4-byte field, and next to one.
static NOINLINE int vector_over_field(struct holds_vector *h) {
  int before_field = h->before, lane = ((int *)&h->lanes)[2], after_field = h->after;
  h->lanes = (vector4){10, 20, 30, 40};
  return (before_field == h->before) + 2 * (after_field == h->after) + 4 * (lane != ((int *)&h->lanes)[2]) + ((int *)&h->lanes)[2];
}
// Another pointer value to the same bytes clobbers; so does a char pointer into the object.
static NOINLINE int two_pointers(int *p, int *q) { int before = *p; *q = before + 1; return *p - before; }
static NOINLINE int char_alias(struct record *r) { int before = r->b; unsigned char *raw = (unsigned char *)r; raw[sizeof(int)] ^= 0xff; return before ^ r->b; }
static NOINLINE int through_memcpy(struct record *r, const int *source) { int before = r->a; memcpy(&r->a, source, sizeof r->a); return r->a - before; }
static NOINLINE int whole_struct_assignment(struct record *r, const struct record *other) { int before = r->b; double real = r->real; *r = *other; return (r->b - before) + (int)(r->real - real); }
// Two locals are different slots; one local through two pointers is one.
static NOINLINE int two_locals(int seed) {
  int x = seed, y = seed * 2;
  int *px = &x, *py = &y;
  int before = *px;
  *py = 1000;
  return before + *px + *py;
}
static NOINLINE int one_local_two_pointers(int seed) {
  int x = seed;
  int *volatile hidden = &x;
  int *p = &x, *q = hidden;
  int before = *p;
  *q = 1000;
  return before + *p;
}
// Array elements: equal constant indices clobber, different ones do not, a variable one might.
static NOINLINE int array_indices(int *a, int i) {
  int at3 = a[3];
  a[4] = 40;
  int still3 = a[3];
  a[3] = 30;
  int now3 = a[3];
  a[i] = 99;
  return at3 + still3 * 10 + now3 * 100 + a[3] * 1000;
}
static NOINLINE int store_in_a_loop(int *a, int n) {
  int first = a[0], total = 0;
  for (int i = 0; i < n; i++) { a[i % 3] += first; total += a[0]; }
  return total;
}
// Volatile and atomic accesses, fences and calls in between.
static int global_word;
static NOINLINE void writes_the_global(void) { global_word += 5; }
static NOINLINE int across_a_call(void) { int before = global_word; writes_the_global(); return global_word - before; }
static NOINLINE int across_a_pointer_call(void (*callee)(void)) { int before = global_word; callee(); return global_word - before; }
static NOINLINE int across_a_volatile_store(int *p) { int before = *p; *(volatile int *)p = before + 3; return *p - before; }
static NOINLINE int across_an_atomic(int *p) { int before = *p; __atomic_fetch_add(p, 4, __ATOMIC_SEQ_CST); return *p - before; }
static NOINLINE int across_a_fence(int *p, int *volatile *other) { int before = *p; __atomic_thread_fence(__ATOMIC_SEQ_CST); **other += 6; return *p - before; }
static NOINLINE int across_an_exchange(int *p) { int before = *p; int old = __atomic_exchange_n(p, 77, __ATOMIC_ACQ_REL); return (old == before) * 1000 + *p; }
// A bit-field write next to a loaded field, and next to another bit-field.
static NOINLINE int bit_fields(struct record *r) {
  int after = r->after_bits; unsigned high = r->high;
  r->low = 31;
  unsigned still_high = r->high;
  r->high = 5;
  return (after == r->after_bits) + 2 * (high == still_high) + 4 * (r->high == 5) + 8 * (r->low == 31);
}

int main(void) {
  struct record r = {1, 2, 3, {4, 5, 6, 7}, {8, 9, 10, 11, 12, 13, 14, 15}, 1.5, 3, 100, 42};
  CHECK(neighbours(&r) == 2 && r.b == 101 && r.wide == 7 && r.halves[0] == 9);
  union pun p;
  p.whole = 0x0102030405060708LL; CHECK(same_offset_narrower(&p) == (0x0102030405060708LL ^ p.whole) && p.words[0] == 0x11111111);
  p.whole = 0x0102030405060708LL; CHECK(upper_half(&p) == (0x0102030405060708LL ^ p.whole) && p.words[1] == 0x22222222);
  p.whole = 0x0102030405060708LL; CHECK(one_byte_in_the_middle(&p) == (0x0102030405060708LL ^ p.whole) && p.bytes[3] == 0x33);
  p.whole = 0x0102030405060708LL; CHECK(first_byte(&p) == (0x0102030405060708LL ^ p.whole) && p.bytes[0] == 0x44);
  p.whole = 0x0102030405060708LL; CHECK(last_byte(&p) == (0x0102030405060708LL ^ p.whole) && p.bytes[7] == 0x55);
  p.whole = 0x0102030405060708LL; { int old = p.words[1]; CHECK(wider_over_narrower(&p) == (old ^ p.words[1]) && p.whole == 0x6666666677777777LL); }
  p.whole = 0x0102030405060708LL; { int old = p.words[0]; CHECK(half_inside_word(&p) == (old ^ p.words[0]) && p.halves[1] == (short)0x8888); }
  p.real = 2.0; CHECK(integer_over_double(&p) == 5.0);
  unsigned char raw[16];
  for (int i = 0; i < 16; i++) raw[i] = (unsigned char)(0xa0 + i);
  { int before; memcpy(&before, raw + 4, 4); int changed = one_byte_overlap_at_the_end(raw); int after; memcpy(&after, raw + 4, 4); CHECK(changed == (before ^ after) && changed != 0 && raw[8] != 0xa8); }
  for (int i = 0; i < 16; i++) raw[i] = (unsigned char)(0xa0 + i);
  { int before; memcpy(&before, raw + 4, 4); int changed = one_byte_overlap_at_the_start(raw); int after; memcpy(&after, raw + 4, 4); CHECK(changed == (before ^ after) && changed != 0 && raw[3] != 0xa3); }
  for (int i = 0; i < 16; i++) raw[i] = (unsigned char)(0xa0 + i);
  CHECK(just_misses_on_both_sides(raw) == 0 && raw[2] != 0xa2 && raw[9] != 0xa9 && raw[4] == 0xa4 && raw[7] == 0xa7);
  struct holds_vector h = {1, {0, 0, 0}, {2, 3, 4, 5}, 6};
  CHECK(vector_over_field(&h) == 1 + 2 + 4 + 30 && h.before == 1 && h.after == 6);
  int one = 10, other = 20;
  CHECK(two_pointers(&one, &other) == 0 && other == 11 && two_pointers(&one, &one) == 1 && one == 11);
  r.b = 0x0f0f0f0f; CHECK(char_alias(&r) == 0xff && r.b == (0x0f0f0f0f ^ 0xff));    // (the first byte is the low one on every target here)
  int source = 500; r.a = 1; CHECK(through_memcpy(&r, &source) == 499 && r.a == 500);
  struct record replacement = {7, 70, 0, {0}, {0}, 9.5, 0, 0, 0};
  r.b = 20; r.real = 1.5; CHECK(whole_struct_assignment(&r, &replacement) == 50 + 8 && r.a == 7);
  CHECK(two_locals(3) == 3 + 3 + 1000 && one_local_two_pointers(3) == 3 + 1000);
  int array[8] = {0, 1, 2, 3, 4, 5, 6, 7};
  CHECK(array_indices(array, 5) == 3 + 30 + 3000 + 30000 && array[5] == 99 && array[4] == 40);
  for (int i = 0; i < 8; i++) array[i] = i;
  CHECK(array_indices(array, 3) == 3 + 30 + 3000 + 99000 && array[3] == 99);
  int looped[3] = {1, 2, 3};
  CHECK(store_in_a_loop(looped, 6) == 2 + 2 + 2 + 3 + 3 + 3 && looped[0] == 3 && looped[1] == 4 && looped[2] == 5);
  CHECK(across_a_call() == 5 && across_a_pointer_call(writes_the_global) == 5 && global_word == 10);
  int word = 1;
  CHECK(across_a_volatile_store(&word) == 3 && across_an_atomic(&word) == 4 && word == 8);
  int *volatile alias = &word;
  CHECK(across_a_fence(&word, &alias) == 6 && across_an_exchange(&word) == 1077 && word == 77);
  CHECK(bit_fields(&r) == 15);
  printf("%d checks, %d wrong\n", checks, wrong);
  return wrong != 0;
}
