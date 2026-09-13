// C11 6.2.2: external, internal and no linkage, and what a later declaration does to an earlier one.
#include <stdio.h>

static int internal = 1;        // internal linkage
extern int internal;            // a later `extern` keeps the linkage the earlier declaration gave: still internal
int external = 2;               // external linkage
extern int external;            // the same object
static int function_internal(void);
int function_external(void);    // external, by default
extern int function_internal(void);   // still internal
static int function_internal(void) { return 10; }
int function_external(void) { return 20; }

int tentative;                  // tentative definitions of one object...
int tentative;
int tentative = 5;              // ...and its one definition
static int tentative_internal;
static int tentative_internal;

static int counter(void) {
  static int calls;             // no linkage, static storage: one per function
  return ++calls;
}
static int other_counter(void) {
  static int calls = 100;       // a different object with the same name
  return ++calls;
}

int main(void) {
  int internal_copy = internal;
  {
    extern int internal;        // in a block: refers to the file-scope object with whatever linkage it has
    extern int external;
    extern int defined_later;
    extern int function_external(void);
    internal += 10;
    printf("%d %d %d %d\n", internal_copy, internal, external, defined_later);
    printf("%d %d\n", function_internal(), function_external());
  }
  int external = 7;             // no linkage: a new object that hides the other
  {
    extern int external;        // the hidden one again
    printf("%d\n", external);
  }
  printf("%d %d %d\n", external, tentative, tentative_internal);
  counter(); counter();
  other_counter();
  printf("%d %d\n", counter(), other_counter());
  // Identifiers with no linkage: parameters, block-scope objects, typedef names, tags, members, enumerators.
  typedef int no_linkage;
  no_linkage value = 3;
  printf("%d\n", value);
  return 0;
}
int defined_later = 30;
