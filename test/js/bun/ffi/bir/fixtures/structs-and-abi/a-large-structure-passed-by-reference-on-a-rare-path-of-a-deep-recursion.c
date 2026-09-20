// The same program where a structure that large goes by the address of a copy the caller makes (arm64, Windows): the
// copy is made for the time of the call, not kept in every activation of the function that makes the call. (No
// reference that does not optimize runs this there: each keeps its 16 KB in all 20,000 frames. The numbers are the
// ones every compiler gives where it runs.)
#include "a-large-structure-passed-on-a-rare-path-of-a-deep-recursion.c"
