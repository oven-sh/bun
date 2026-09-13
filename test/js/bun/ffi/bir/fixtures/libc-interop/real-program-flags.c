// Bit-field flags packed into a header word, as a wire-format style struct.
#include <stdbool.h>
#include <stdint.h>
#include <string.h>

// (Bit-fields of different types share a word only in the System V layout, so it is asked for by name: Windows has another.)
struct __attribute__((gcc_struct)) PacketHeader {
    unsigned version : 3;
    unsigned type : 5;
    bool urgent : 1;
    bool encrypted : 1;
    unsigned : 2;
    unsigned sequence : 20;
    int16_t delta : 12;
    unsigned priority : 4;
};

_Static_assert(sizeof(struct PacketHeader) == 8, "two 32-bit words");

uint64_t pack(unsigned version, unsigned type, bool urgent, unsigned sequence, int delta) {
    struct PacketHeader h = { .version = version, .type = type, .urgent = urgent, .sequence = sequence, .delta = (int16_t)delta, .priority = 9 };
    h.encrypted = !urgent;
    uint64_t raw;
    memcpy(&raw, &h, sizeof raw);
    return raw;
}

int unpack_sum(uint64_t raw) {
    struct PacketHeader h;
    memcpy(&h, &raw, sizeof h);
    h.sequence += 1;
    h.delta -= 1;
    return (int)(h.version + h.type * 10 + h.urgent * 1000 + h.encrypted * 2000 + h.sequence * 10000 + h.priority * 100) + h.delta;
}

int printf(const char *, ...);
int main(void) {
  printf("%lld\n", (long long)pack(5, 17, 1, 123456, -100));
  printf("%d\n", (int)unpack_sum(175492869390733LL));
  printf("%lld\n", (long long)pack(7, 31, 0, 1048575, 2047));
  printf("%d\n", (int)unpack_sum(167125767418623LL));
  return 0;
}
