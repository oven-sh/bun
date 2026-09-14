// Constructors of several files: by priority first (lower numbers earlier, none given last), then in the
// order the files were given.
#include <stdio.h>
extern int order[];
extern int count;
int main(void) {
  for (int i = 0; i < count; i++) printf("%d ", order[i]);
  printf("\n");
  return 0;
}
