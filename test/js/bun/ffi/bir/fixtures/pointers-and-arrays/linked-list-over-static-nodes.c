struct Node { int value; struct Node *next; };
         static struct Node pool[8];
         static int used;
         static struct Node *push(struct Node *head, int v) {
             struct Node *n = &pool[used++];
             n->value = v; n->next = head;
             return n;
         }
         int build_and_sum(int n) {
             used = 0;
             struct Node *head = 0;
             for (int i = 1; i <= n; i++) head = push(head, i * i);
             int sum = 0, count = 0;
             for (struct Node *p = head; p; p = p->next) { sum += p->value; count++; }
             return sum * 10 + count + (head->next->next == &pool[n - 3]);
         }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)build_and_sum(5));
  printf("%d\n", (int)build_and_sum(8));
  return 0;
}
