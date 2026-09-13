// C11 6.2.3: labels, tags, the members of each structure or union, and everything else live in separate name spaces.
#include <stdio.h>

struct same { int same; };            // a tag and a member
union other { int same; float other; };   // another structure's members are another name space again
enum same_enum { same_enumerator = 4 };   // (enumerators are ordinary identifiers, tags are not)
typedef struct same same_t;

static int same(struct same same) {   // a function (ordinary), a tag, and a parameter (ordinary, inner scope)
  goto same;                          // a label
same:
  return same.same;
}

struct list { struct list *list; int value; };

int main(void) {
  struct same s = {3};
  union other other = {.same = 5};
  int result = same(s);
  struct same same = {7};             // an ordinary identifier now hides the function, not the tag
  same_t typedefed = same;
  struct list tail = {0, 1}, list = {&tail, 2};
  printf("%d %d %d %d %d\n", result, other.same, same.same, typedefed.same, same_enumerator);
  printf("%d %d\n", list.list->value, (int)sizeof(struct same));
  {
    enum { list = 9 };                // hides the variable; the tag `struct list` is untouched
    struct list *p = &tail;
    printf("%d %d\n", list, p->value);
  }
  return 0;
}
