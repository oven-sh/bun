// Edge coverage of the reference libwebp, for choosing test cases.
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#define MAX_EDGES (1 << 20)
static uint8_t seen[MAX_EDGES];   // ever hit by a kept case
static uint8_t cur[MAX_EDGES];    // hit since cov_begin
static uint32_t touched[MAX_EDGES];
static uint32_t ntouched, nguards;
void __sanitizer_cov_trace_pc_guard_init(uint32_t* start, uint32_t* stop) {
  if (start == stop || *start) return;
  for (uint32_t* x = start; x < stop; x++) *x = ++nguards;
}
void __sanitizer_cov_trace_pc_guard(uint32_t* guard) {
  uint32_t g = *guard;
  if (g >= MAX_EDGES || cur[g]) return;
  cur[g] = 1; touched[ntouched++] = g;
}
void cov_begin(void) { for (uint32_t i = 0; i < ntouched; i++) cur[touched[i]] = 0; ntouched = 0; }
// Number of edges hit since cov_begin that no kept case had hit; if `keep`, they now count as hit.
uint32_t cov_end(int keep) {
  uint32_t n = 0;
  for (uint32_t i = 0; i < ntouched; i++) if (!seen[touched[i]]) { n++; if (keep) seen[touched[i]] = 1; }
  return n;
}
uint32_t cov_total(void) { uint32_t n = 0; for (uint32_t i = 0; i <= nguards && i < MAX_EDGES; i++) n += seen[i]; return n; }
uint32_t cov_guards(void) { return nguards; }
