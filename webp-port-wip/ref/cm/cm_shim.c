// The reference's CostManager, driven directly. The .c file is included for its static functions.
#define VP8LBackwardReferencesTraceBackwards cm_unused_trace_backwards
#include "src/enc/backward_references_cost_enc.c"

typedef struct { CostManager m; CostModel model; uint32_t lit[256 + 24]; uint16_t* dist; int n; } CM;

CM* cm_new(int n, const uint32_t* len_costs) {
  CM* c = (CM*)calloc(1, sizeof(*c));
  int i;
  for (i = 0; i < 24; ++i) c->lit[256 + i] = len_costs[i];
  c->model.literal = c->lit;
  c->dist = (uint16_t*)calloc(n, sizeof(uint16_t));
  c->n = n;
  CostManagerInitFreeList(&c->m);
  if (!CostManagerInit(&c->m, c->dist, n, &c->model)) abort();
  return c;
}
void cm_literal(CM* c, int i, int64_t cost) {
  if (c->m.costs[i] > cost) { c->m.costs[i] = cost; c->m.dist_array[i] = 1; }
}
void cm_push(CM* c, int64_t cost, int position, int len) { PushInterval(&c->m, cost, position, len); }
void cm_update(CM* c, int i, int clean) { UpdateCostAtIndex(&c->m, i, clean); }
int64_t cm_cost(CM* c, int i) { return c->m.costs[i]; }
int cm_count(CM* c) { return c->m.count; }
void cm_get(CM* c, int64_t* costs, uint16_t* dist) {
  memcpy(costs, c->m.costs, c->n * sizeof(*costs)); memcpy(dist, c->dist, c->n * sizeof(*dist));
}
void cm_free(CM* c) { CostManagerClear(&c->m); free(c->dist); free(c); }
