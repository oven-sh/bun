// `p->self = p; p++`: the value stored is the base of the address it is stored to, and the pointer is stepped right
// after. A processor with stores that step their base register (arm64) must not fold the two when the register
// stored is the base itself. For steps of 8, 16, 0x78, 255, 256 and -16 bytes, as a structure that points to
// itself, as a word that holds its own address, and the load flavour.
#include <stdint.h>
#include <stdio.h>
#include <string.h>

#define NOINLINE __attribute__((noinline))
static int checks, wrong;
#define CHECK(c) do { int holds = (c) ? 1 : 0; checks++; wrong += !holds; printf("%s => %d\n", #c, holds); } while (0)

// A structure of `size` bytes whose first member points to itself; an array of them is walked with p++.
#define NODE(size) struct node_##size { struct node_##size *self; char rest[size - sizeof(void *)]; }; \
  static NOINLINE struct node_##size *link_##size(struct node_##size *p, int count) { \
    for (int i = 0; i < count; i++) { p->self = p; p++; } \
    return p; \
  } \
  static NOINLINE struct node_##size *link_backwards_##size(struct node_##size *p, int count) { \
    for (int i = 0; i < count; i++) { p->self = p; p--; } \
    return p; \
  } \
  static NOINLINE int check_##size(void) { \
    static struct node_##size nodes[13]; \
    memset(nodes, 0, sizeof nodes); \
    int ok = link_##size(nodes, 12) == nodes + 12; \
    for (int i = 0; i < 12; i++) ok &= nodes[i].self == &nodes[i]; \
    memset(nodes, 0, sizeof nodes); \
    ok &= link_backwards_##size(nodes + 12, 12) == nodes && nodes[0].self == 0; \
    for (int i = 1; i <= 12; i++) ok &= nodes[i].self == &nodes[i]; \
    return ok; \
  }
NODE(8) NODE(16) NODE(120) NODE(256) NODE(24) NODE(4096)

// Steps that are no multiple of the element size, through byte arithmetic.
static NOINLINE char *step_by(char *p, long long step, int count) {
  for (int i = 0; i < count; i++) {
    char *self = p;
    memcpy(p, &self, sizeof self);        // *(char **)p = p
    p = p + step;
  }
  return p;
}
static NOINLINE int stepped(long long step) {
  static char buffer[8192];
  memset(buffer, 0, sizeof buffer);
  char *start = step > 0 ? buffer : buffer + sizeof buffer - 64;
  int ok = step_by(start, step, 16) == start + 16 * step;
  for (int i = 0; i < 16; i++) {
    char *stored;
    memcpy(&stored, start + i * step, sizeof stored);
    ok &= stored == start + i * step;
  }
  return ok;
}

// A word that holds its own address, stepped by one element: `*p = (long)p; p++`.
static NOINLINE uintptr_t *own_addresses(uintptr_t *p, uintptr_t *end) {
  while (p < end) { *p = (uintptr_t)p; p++; }
  return p;
}
static NOINLINE uintptr_t *own_addresses_post_increment(uintptr_t *p, uintptr_t *end) {
  while (p < end) { uintptr_t *at = p++; *at = (uintptr_t)at; }
  return p;
}
static NOINLINE uintptr_t *own_addresses_downwards(uintptr_t *p, uintptr_t *begin) {
  while (p > begin) { --p; *p = (uintptr_t)p; }
  return p;
}
// The load flavour: what is loaded from p replaces nothing, p steps, and the two must not be confused when the
// loaded value is an address in the same array.
static NOINLINE uintptr_t chase(uintptr_t *p, int count) {
  uintptr_t total = 0;
  for (int i = 0; i < count; i++) { uintptr_t *q = (uintptr_t *)*p; p++; total += (uintptr_t)(q - p) + 1; }
  return total;
}
// A list threaded through an array: every node's link is the next node, stored while stepping.
struct link { struct link *next; long long payload; };
static NOINLINE struct link *thread(struct link *p, int count) {
  for (int i = 0; i < count; i++) { p->next = p + 1; p->payload = i; p++; }
  p[-1].next = 0;
  return p;
}

int main(void) {
  CHECK(check_8()); CHECK(check_16()); CHECK(check_24()); CHECK(check_120()); CHECK(check_256()); CHECK(check_4096());
  CHECK(stepped(8)); CHECK(stepped(16)); CHECK(stepped(0x78)); CHECK(stepped(255)); CHECK(stepped(256)); CHECK(stepped(-16)); CHECK(stepped(-255)); CHECK(stepped(9));
  static uintptr_t words[64];
  int ok = own_addresses(words, words + 64) == words + 64;
  for (int i = 0; i < 64; i++) ok &= words[i] == (uintptr_t)&words[i];
  CHECK(ok);
  memset(words, 0, sizeof words);
  ok = own_addresses_post_increment(words, words + 64) == words + 64;
  for (int i = 0; i < 64; i++) ok &= words[i] == (uintptr_t)&words[i];
  CHECK(ok);
  memset(words, 0, sizeof words);
  ok = own_addresses_downwards(words + 64, words) == words;
  for (int i = 0; i < 64; i++) ok &= words[i] == (uintptr_t)&words[i];
  CHECK(ok);
  CHECK(chase(words, 64) == 0);
  static struct link links[10];
  ok = thread(links, 10) == links + 10;
  int length = 0;
  for (struct link *at = links; at; at = at->next) ok &= at->payload == length++;
  CHECK(ok && length == 10);
  printf("%d checks, %d wrong\n", checks, wrong);
  return wrong != 0;
}
