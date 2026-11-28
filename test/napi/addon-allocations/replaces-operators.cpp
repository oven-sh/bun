// A library that links an allocator of its own: it replaces operator new and operator delete and exports them. Every
// block has a header in front that only this library knows, so no other operator delete can release one.
#include <cstdlib>
#include <new>
#include <node_api.h>

namespace {
constexpr size_t headerSize = 16;
}

void* operator new(size_t size)
{
    void* block = malloc(size + headerSize);
    if (!block)
        abort();
    return static_cast<char*>(block) + headerSize;
}

void operator delete(void* block) noexcept
{
    if (block)
        free(static_cast<char*>(block) - headerSize);
}

void operator delete(void* block, size_t) noexcept { ::operator delete(block); }

NAPI_MODULE_INIT() { return exports; }
