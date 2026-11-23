// Loaded after replaces-operators.cpp. Prints which image its operator new and its operator delete are in, and has the
// second release what the first allocated.
#include <cstdio>
#include <cstring>
#include <dlfcn.h>
#include <new>
#include <node_api.h>

namespace {

const char* imageOf(void* function)
{
    Dl_info image;
    if (!dladdr(function, &image) || !image.dli_fname)
        return "no image";
    const char* slash = strrchr(image.dli_fname, '/');
    return slash ? slash + 1 : image.dli_fname;
}

}

NAPI_MODULE_INIT()
{
    void* (*allocate)(size_t) = &::operator new;
    void (*release)(void*) noexcept = &::operator delete;
    printf("operator new: %s\noperator delete: %s\n", imageOf(reinterpret_cast<void*>(allocate)), imageOf(reinterpret_cast<void*>(release)));
    fflush(stdout);
    for (int i = 0; i < 1000; i++) {
        void* volatile block = allocate(32);
        release(block);
    }
    printf("released 1000 blocks\n");
    fflush(stdout);
    return exports;
}
