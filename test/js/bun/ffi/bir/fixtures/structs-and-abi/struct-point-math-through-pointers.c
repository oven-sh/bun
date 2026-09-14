struct Point { int x; int y; };
         static void add(struct Point *a, const struct Point *b) { a->x += b->x; a->y += b->y; }
         static int dot(struct Point *a, struct Point *b) { return a->x * b->x + a->y * b->y; }
         int run(int k) {
             struct Point p = { 1, 2 }, q = { .y = 10, .x = k };
             add(&p, &q);
             struct Point r;
             r = p;
             r.x++;
             (&r)->y -= 2;
             return dot(&p, &r) + (*&q).x;
         }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)run(3));
  return 0;
}
