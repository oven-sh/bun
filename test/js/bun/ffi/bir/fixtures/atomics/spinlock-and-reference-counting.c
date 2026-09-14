#include <stdatomic.h>
         void *malloc(unsigned long);
         void free(void *);
         typedef struct { atomic_flag held; int owner; } spinlock;
         static spinlock lock = { ATOMIC_FLAG_INIT, -1 };
         static int protected_total;
         static void acquire(spinlock *l, int who) {
             while (atomic_flag_test_and_set_explicit(&l->held, memory_order_acquire)) { }
             l->owner = who;
         }
         static int try_acquire(spinlock *l) { return !atomic_flag_test_and_set_explicit(&l->held, memory_order_acquire); }
         static void release(spinlock *l) { l->owner = -1; atomic_flag_clear_explicit(&l->held, memory_order_release); }
         int critical(int rounds) {
             int contended = 0;
             for (int i = 0; i < rounds; i++) {
                 acquire(&lock, i);
                 contended += !try_acquire(&lock);
                 protected_total += lock.owner;
                 release(&lock);
             }
             return protected_total * 100 + contended + (lock.owner == -1);
         }
         /* A ticket lock built from compare-and-swap. */
         static _Atomic unsigned state;
         int cas_lock(void) {
             unsigned expected = 0;
             int spins = 0;
             while (!atomic_compare_exchange_weak(&state, &expected, 1)) { expected = 0; spins++; if (spins == 3) state = 0; }
             return spins + (int)state * 10;
         }
         struct buffer { atomic_int refs; int length; char *bytes; };
         static int live;
         static struct buffer *create(int n) {
             struct buffer *b = malloc(sizeof *b);
             atomic_init(&b->refs, 1);
             b->length = n;
             b->bytes = malloc(n);
             live++;
             return b;
         }
         static struct buffer *retain(struct buffer *b) { atomic_fetch_add_explicit(&b->refs, 1, memory_order_relaxed); return b; }
         static void drop(struct buffer *b) {
             if (atomic_fetch_sub_explicit(&b->refs, 1, memory_order_release) == 1) {
                 atomic_thread_fence(memory_order_acquire);
                 free(b->bytes);
                 free(b);
                 live--;
             }
         }
         int refcounts(void) {
             struct buffer *b = create(32);
             struct buffer *alias = retain(retain(b));
             int peak = atomic_load(&b->refs);
             drop(alias);
             drop(b);
             int mid = atomic_load(&alias->refs) * 10 + live;
             drop(alias);
             return peak * 1000 + mid * 10 + live;
         }

int printf(const char *, ...);
int main(void) {
  printf("%d\n", (int)critical(5));
  printf("%d\n", (int)cas_lock());
  printf("%d\n", (int)cas_lock());
  printf("%d\n", (int)refcounts());
  return 0;
}
