// C11 6.7.9: initializers for scalars, arrays, structures, unions and strings; designators; brace elision;
// what is left out is zero; static and automatic objects alike.
#include <stdio.h>
#include <string.h>

struct point { int x, y; };
struct line { struct point from, to; int color; };
struct mixed { char tag; double value; int list[3]; struct point where; const char *name; };
union number { int integer; float real; char bytes[8]; };
struct with_union { int kind; union number n; };

static int zeroed_scalar; static struct mixed zeroed_struct; static int *zeroed_pointer; static double zeroed_array[3];
static int scalar = 5, braced_scalar = {6};
static int array[5] = {1, 2}, sized_by_initializer[] = {1, 2, 3, 4}, designated[10] = {[2] = 20, 21, [7] = 70, [9] = 90};
static int last_wins[3] = {[0] = 1, [0] = 2, [2] = 3, [1] = 5};
static struct point p = {1, 2}, partly = {.y = 9}, out_of_order = {.y = 2, .x = 1};
static struct line elided = {1, 2, 3, 4, 5}, braced = {{1, 2}, {3, 4}, 5}, mixed_braces = {{1}, 3, 4};
static struct line nested_designators = {.to.y = 8, .from = {.x = 1}, .color = 3};
static struct mixed everything = {'t', 2.5, {1, 2, 3}, {4, 5}, "name"}, designated_array_member = {.list[1] = 7, .list[2] = 8};
static union number first_member = {65}, by_designator = {.real = 1.0f}, bytes = {.bytes = "abc"};
static struct with_union holder = {1, {.real = 2.0f}}, array_of_holders[2] = {[1].n.integer = 5, [0] = {.kind = 9}};
static char text[] = "abc", exact[3] = "abc", roomy[6] = "ab", braced_text[] = {"xyz"}, by_characters[] = {'a', 'b', 0};
static const char *words[] = {"one", "two", [3] = "four"};
static int grid[2][3] = {{1, 2, 3}, {4, 5, 6}}, flat_grid[2][3] = {1, 2, 3, 4}, ragged[][2] = {{1}, {2, 3}, 4};
static struct point points[] = {{1, 2}, {.y = 4}, 5, 6, [5] = {7, 8}};

static int sum(const int *values, int count) { int total = 0; for (int i = 0; i < count; i++) total += values[i]; return total; }

int main(void) {
  printf("%d %d %d %.0f %d %d\n", zeroed_scalar, zeroed_struct.list[2], zeroed_pointer == 0, zeroed_array[2], scalar, braced_scalar);
  printf("%d %d %d %d %d %d\n", sum(array, 5), (int)(sizeof sized_by_initializer / sizeof(int)), designated[3], designated[8], sum(designated, 10), sum(last_wins, 3));
  printf("%d %d %d %d\n", p.x + p.y, partly.x + partly.y, out_of_order.x, elided.to.y + braced.to.y);
  printf("%d %d %d %d %d\n", mixed_braces.from.y, mixed_braces.to.x, mixed_braces.to.y, nested_designators.to.y + nested_designators.from.x, nested_designators.to.x);
  printf("%c %.1f %d %d %s %d %d\n", everything.tag, everything.value, everything.list[2], everything.where.y, everything.name, designated_array_member.list[2], designated_array_member.list[0]);
  printf("%d %d %s %d %.1f %d %d\n", first_member.integer, by_designator.integer == 0x3f800000, bytes.bytes, holder.kind, holder.n.real, array_of_holders[1].n.integer, array_of_holders[0].kind);
  printf("%d %d %c %d %d %d %d\n", (int)sizeof text, (int)sizeof exact, exact[2], roomy[5], (int)sizeof braced_text, (int)sizeof by_characters, (int)(sizeof words / sizeof words[0]));
  printf("%s %d %d %d %d %d\n", words[3], words[2] == 0, grid[1][1], flat_grid[1][0] + flat_grid[1][2], (int)(sizeof ragged / sizeof ragged[0]), ragged[2][0] + ragged[2][1]);
  printf("%d %d %d %d %d\n", (int)(sizeof points / sizeof points[0]), points[1].x + points[1].y, points[2].x + points[2].y, points[4].x, points[5].y);
  // The same for automatic objects, where initializers need not be constant and side effects happen once each.
  int n = 3, calls = 0;
  int automatic[5] = {n, n * 2, [4] = ++calls};
  struct line runtime = {.from = {n, n + 1}, .color = calls};
  struct mixed local = {.value = n / 2.0, .list = {[2] = n}, .name = words[1]};
  struct point copied = p, from_array = points[5];
  char local_text[8] = "hi";
  int empty_tail[4] = {1};
  printf("%d %d %d %d %d\n", sum(automatic, 5), runtime.from.y + runtime.to.x + runtime.color, calls, local.list[2] + local.list[0], copied.x + from_array.x);
  printf("%.1f %s %s %d %d\n", local.value, local.name, local_text, local_text[7], sum(empty_tail, 4));
  // An initializer list for an automatic aggregate zeroes whatever it does not mention, every time.
  for (int round = 0; round < 2; round++) {
    int scratch[4] = {round};
    scratch[3] += 5;
    printf("%d ", sum(scratch, 4));
  }
  printf("\n");
  struct { int a; struct point inner[2]; } deep = {1, {{2}, {.y = 5}}};
  printf("%d %d %d\n", deep.inner[0].x, deep.inner[0].y, deep.inner[1].y);
  return 0;
}
