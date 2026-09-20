// C11 6.2.1: file, function, block and function-prototype scope; where a scope starts; hiding.
#include <stdio.h>

static int x = 1;                       // file scope
static int twice(int x) { return 2 * x; }   // the parameter hides the file-scope x
static int prototype_scope(int n, int array[n]);   // n is in scope for the rest of its prototype, and no further
static int prototype_scope(int n, int array[n]) { return array[n - 1]; }

struct tag { int a; };                  // a tag has scope too

static int labels(int which) {
  // A label has function scope: it can be used before it appears, and from an inner block.
  if (which == 0) goto end;
  { if (which == 1) goto inner; }
  return 10;
  {
  inner:
    return 11;
  }
end:
  return 12;
}

int main(void) {
  printf("%d %d\n", x, twice(5));
  int outer = x;        // still the file-scope x
  int x = 2;            // from here on, this one
  {
    int seen = x;       // the enclosing block's
    long long x = sizeof x;   // the scope of an identifier starts after its declarator: this is the size of the new x
    x = x == sizeof(long long) ? 3 : -1;
    {
      extern int x_elsewhere;   // block scope, but it names the file-scope object
      struct tag { char c[7]; } local;   // hides the file-scope tag until the block ends
      printf("%d %d %d %d\n", seen, (int)x, x_elsewhere, (int)sizeof local);
    }
    struct tag file_scope_one = {4};
    printf("%d\n", (int)sizeof file_scope_one == (int)sizeof(int));
  }
  printf("%d %d\n", outer, x);
  // An enumeration constant is in scope right after its enumerator, a struct tag right after it appears.
  enum { FIRST = 5, SECOND = FIRST + 1 };
  struct node { struct node *next; int value; } tail = {0, 1}, head = {&tail, 2};
  printf("%d %d\n", SECOND, head.next->value);
  // Each iteration statement and each of its substatements is a block of its own.
  for (int i = 0; i < 2; i++) {
    int i = 40;   // hides the loop's i without touching it
    x += i;
  }
  if (sizeof(struct in_condition { int a, b; }) > 0) x += 1;
  printf("%d %d %d %d\n", x, labels(0), labels(1), labels(2));
  int array[3] = {7, 8, 9};
  printf("%d\n", prototype_scope(3, array));
  return 0;
}
int x_elsewhere = 99;
