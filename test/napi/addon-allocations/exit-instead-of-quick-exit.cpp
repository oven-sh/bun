// Preloaded into a process, makes it end with exit() where it would end with quick_exit().
#include <cstdlib>

extern "C" [[noreturn]] void quick_exit(int code) noexcept
{
    exit(code);
}
