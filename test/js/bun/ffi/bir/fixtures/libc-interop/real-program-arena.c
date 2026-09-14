// A bump allocator: uint8_t/uintptr_t arithmetic, offsetof, alignment math.
#include <stdalign.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

struct Arena {
    uint8_t *base;
    size_t size;
    size_t used;
    unsigned allocations;
};

struct Header {
    uint32_t magic;
    uint16_t align;
    uint16_t pad;
    size_t size;
    alignas(16) uint8_t payload[];
};

_Static_assert(offsetof(struct Header, payload) == 16, "payload starts on a 16-byte boundary");
_Static_assert(sizeof(struct Header) == 16, "flexible array member adds no size");

static alignas(64) uint8_t storage[4096];

void arena_init(struct Arena *a) {
    a->base = storage;
    a->size = sizeof storage;
    a->used = 0;
    a->allocations = 0;
    memset(storage, 0xcd, sizeof storage);
}

static uintptr_t align_up(uintptr_t p, size_t align) {
    return (p + (align - 1)) & ~(uintptr_t)(align - 1);
}

void *arena_alloc(struct Arena *a, size_t size, size_t align) {
    if (align < alignof(max_align_t)) align = alignof(max_align_t);
    uintptr_t start = (uintptr_t)a->base + a->used;
    uintptr_t payload = align_up(start + sizeof(struct Header), align);
    uintptr_t end = payload + size;
    if (end > (uintptr_t)a->base + a->size) return NULL;
    struct Header *h = (struct Header *)(payload - sizeof(struct Header));
    h->magic = 0xa11c0de5u;
    h->align = (uint16_t)align;
    h->pad = (uint16_t)(payload - start - sizeof(struct Header));
    h->size = size;
    a->used = (size_t)(end - (uintptr_t)a->base);
    a->allocations++;
    return (void *)payload;
}

size_t arena_block_size(const void *p) {
    const struct Header *h = (const struct Header *)((const uint8_t *)p - offsetof(struct Header, payload));
    return h->magic == 0xa11c0de5u ? h->size : 0;
}

// Returns a checksum over a few allocations so the caller can verify layout and contents.
uint64_t arena_demo(void) {
    struct Arena a;
    arena_init(&a);
    uint32_t *numbers = arena_alloc(&a, 10 * sizeof *numbers, alignof(uint32_t));
    char *text = arena_alloc(&a, 6, 1);
    double *aligned = arena_alloc(&a, sizeof(double), 256);
    void *too_big = arena_alloc(&a, 1 << 20, 8);
    for (uint32_t i = 0; i < 10; i++) numbers[i] = i * i;
    memcpy(text, "arena", 6);
    *aligned = 0.5;
    uint64_t sum = 0;
    for (int i = 0; i < 10; i++) sum += numbers[i];
    sum = sum * 1000 + arena_block_size(text) * 100 + arena_block_size(aligned);
    sum = sum * 10 + ((uintptr_t)aligned % 256 == 0) + ((uintptr_t)numbers % 16 == 0) + (too_big == NULL) + (a.allocations == 3);
    return sum * 10 + (text[4] == 'a');
}

int printf(const char *, ...);
int main(void) {
  printf("%lld\n", (long long)arena_demo());
  return 0;
}
