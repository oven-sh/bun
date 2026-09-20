// Structs through pointers, nested aggregates, a linked list over a static pool.

struct Vec2 { double x, y; };
struct Rect { struct Vec2 min, max; int tag; };

struct Node { int value; struct Node *next; };

static struct Node pool[16];
static int pool_used;

static struct Rect unit = { { 0, 0 }, { 1, 1 }, 7 };

double rect_area(const struct Rect *r) {
    return (r->max.x - r->min.x) * (r->max.y - r->min.y);
}

void rect_scale(struct Rect *r, double k) {
    r->max.x = r->min.x + (r->max.x - r->min.x) * k;
    r->max.y = r->min.y + (r->max.y - r->min.y) * k;
}

double scaled_unit_area(double k) {
    struct Rect r = unit;
    rect_scale(&r, k);
    return rect_area(&r) + r.tag;
}

// Caller-provided memory: fills `out` (at least sizeof(struct Rect) = 40 bytes).
void make_rect(struct Rect *out, double w, double h) {
    struct Rect r = { .max = { w, h }, .tag = 1 };
    *out = r;
}

int rect_size(void) { return sizeof(struct Rect); }

static struct Node *push(struct Node *head, int value) {
    struct Node *n = &pool[pool_used++ & 15];
    n->value = value;
    n->next = head;
    return n;
}

int list_sum_of_squares(int n) {
    pool_used = 0;
    struct Node *head = 0;
    for (int i = 1; i <= n && i <= 16; i++) head = push(head, i * i);
    int sum = 0;
    for (struct Node *p = head; p; p = p->next) sum += p->value;
    return sum;
}

int printf(const char *, ...);
static void bun_test_fill(unsigned char *to, const unsigned char *from, int n) {
  for (int i = 0; i < n; i++) to[i] = from[i];
}
static void bun_test_dump(const char *name, const unsigned char *p, int n) {
  printf("%s:", name);
  for (int i = 0; i < n; i++) printf(" %02x", p[i]);
  printf("\n");
}
static unsigned char buffer1[40] __attribute__((aligned(16)));
int main(void) {
  printf("%.17g\n", (double)scaled_unit_area(0x1.8000000000000p+1));
  for (int i = 0; i < 40; i++) buffer1[i] = 0;
  make_rect((void *)buffer1, 0x1.8000000000000p+1, 0x1.0000000000000p+2);
  bun_test_dump("buffer1", buffer1, 40);
  printf("%.17g\n", (double)rect_area((void *)buffer1));
  printf("%d\n", (int)rect_size());
  printf("%d\n", (int)list_sum_of_squares(5));
  return 0;
}
