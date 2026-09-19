// Word-frequency counter: malloc/realloc/free, strcmp, qsort, ctype.
#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

struct Entry {
    char *word;
    int count;
};

struct Table {
    struct Entry *entries;
    size_t len, cap;
};

static struct Entry *find_or_add(struct Table *t, const char *word, size_t n) {
    for (size_t i = 0; i < t->len; i++)
        if (strlen(t->entries[i].word) == n && memcmp(t->entries[i].word, word, n) == 0) return &t->entries[i];
    if (t->len == t->cap) {
        t->cap = t->cap ? t->cap * 2 : 4;
        t->entries = realloc(t->entries, t->cap * sizeof *t->entries);
        if (!t->entries) abort();
    }
    struct Entry *e = &t->entries[t->len++];
    e->word = malloc(n + 1);
    memcpy(e->word, word, n);
    e->word[n] = '\0';
    e->count = 0;
    return e;
}

static int by_count_then_word(const void *a, const void *b) {
    const struct Entry *x = a, *y = b;
    if (x->count != y->count) return y->count - x->count;
    return strcmp(x->word, y->word);
}

// Writes "word:count" lines for the `top` most frequent words into `out`; returns the
// number of distinct words.
int word_frequencies(const char *text, char *out, size_t out_size, int top) {
    struct Table table = { 0 };
    const char *p = text;
    while (*p) {
        while (*p && !isalpha((unsigned char)*p)) p++;
        const char *start = p;
        while (isalpha((unsigned char)*p)) p++;
        if (p > start) {
            char lowered[64];
            size_t n = (size_t)(p - start) < sizeof lowered ? (size_t)(p - start) : sizeof lowered - 1;
            for (size_t i = 0; i < n; i++) lowered[i] = (char)tolower((unsigned char)start[i]);
            find_or_add(&table, lowered, n)->count++;
        }
    }
    qsort(table.entries, table.len, sizeof *table.entries, by_count_then_word);
    size_t used = 0;
    for (size_t i = 0; i < table.len && (int)i < top; i++) {
        int n = snprintf(out + used, out_size - used, "%s:%d\n", table.entries[i].word, table.entries[i].count);
        if (n < 0 || (size_t)n >= out_size - used) break;
        used += (size_t)n;
    }
    int distinct = (int)table.len;
    for (size_t i = 0; i < table.len; i++) free(table.entries[i].word);
    free(table.entries);
    return distinct;
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
static unsigned char buffer1[96] __attribute__((aligned(16)));
static unsigned char buffer2[256] __attribute__((aligned(16)));
int main(void) {
  bun_test_fill(buffer1, (const unsigned char[]){116, 104, 101, 32, 113, 117, 105, 99, 107, 32, 98, 114, 111, 119, 110, 32, 102, 111, 120, 32, 106, 117, 109, 112, 115, 32, 111, 118, 101, 114, 32, 116, 104, 101, 32, 108, 97, 122, 121, 32, 100, 111, 103, 46, 32, 84, 104, 101, 32, 68, 79, 71, 32, 98, 97, 114, 107, 115, 59, 32, 116, 104, 101, 32, 102, 111, 120, 32, 114, 117, 110, 115, 33, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0}, 96);
  for (int i = 0; i < 256; i++) buffer2[i] = 0;
  printf("%d\n", (int)word_frequencies((void *)buffer1, (void *)buffer2, 256LL, 4));
  bun_test_dump("buffer2", buffer2, 256);
  return 0;
}
