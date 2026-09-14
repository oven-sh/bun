// C11 7.21.6.1: %n stores how many characters have been written so far. (Apple's library insists that the format
// then be in memory nobody can write, which a string literal is; Microsoft's refuses %n unless asked.)
#include <stdio.h>

int main(void) {
  char line[64];
  int so_far = 0, at_the_end = 0; short narrow = 0; long long wide = 0;
  snprintf(line, sizeof line, "%s|%c%n and then some%n", "text", 'z', &so_far, &at_the_end);
  printf("%s %d %d\n", line, so_far, at_the_end);
  snprintf(line, sizeof line, "12345%hn6789%lln", &narrow, &wide);
  printf("%d %lld%n\n", narrow, wide, &so_far);
  printf("%d\n", so_far);
  return 0;
}
