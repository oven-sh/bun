// Allocates in every way a native addon does and releases the blocks where addons do: static destructors, atexit
// handlers, cleanup hooks, finalizers, thread-local destructors and threads of its own. Every block is filled when it
// is made and read back before it is released. A block that reads back differently is reported on stderr. Each place
// that runs while the process or the environment ends prints one line on stdout.
#define NAPI_VERSION 10
#include <node_api.h>

#include <atomic>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <exception>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <new>
#include <sstream>
#include <stdexcept>
#include <string>
#include <thread>
#include <unistd.h>
#include <vector>

namespace {

void writeLine(int fd, const char* first, const char* second)
{
    char line[256];
    int length = snprintf(line, sizeof(line), "%s%s\n", first, second);
    ssize_t written = write(fd, line, static_cast<size_t>(length));
    static_cast<void>(written);
}

void reportDamage(const char* owner, const char* kind)
{
    char line[256];
    snprintf(line, sizeof(line), "%s: the block from %s", owner, kind);
    writeLine(2, line, " does not hold the bytes that were written to it");
}

void announceRelease(const char* place) { writeLine(1, "released by ", place); }

unsigned char byteAt(size_t index, unsigned seed) { return static_cast<unsigned char>(index * 31 + seed * 7 + 1); }

void fill(void* block, size_t size, unsigned seed)
{
    auto* bytes = static_cast<unsigned char*>(block);
    for (size_t i = 0; i < size; i++)
        bytes[i] = byteAt(i, seed);
}

bool holds(const void* block, size_t size, unsigned seed)
{
    auto* bytes = static_cast<const unsigned char*>(block);
    for (size_t i = 0; i < size; i++) {
        if (bytes[i] != byteAt(i, seed))
            return false;
    }
    return true;
}

std::string makeText(size_t length, unsigned seed)
{
    std::string text;
    for (size_t i = 0; i < length; i++)
        text.push_back(static_cast<char>('a' + (i + seed) % 26));
    return text;
}

struct alignas(128) Aligned {
    unsigned char bytes[384];
};

// One block of every kind.
class Blocks {
public:
    explicit Blocks(const char* owner)
        : m_owner(owner)
    {
    }
    Blocks(const Blocks&) = delete;
    Blocks& operator=(const Blocks&) = delete;
    ~Blocks() { release(); }

    void allocate(unsigned seed)
    {
        release();
        m_seed = seed;
        m_size = 1 + (seed * 2654435761u) % 40000;
        m_allocated = true;

        m_malloc = malloc(m_size);
        fill(m_malloc, m_size, seed);

        m_calloc = calloc(m_size, 3);
        m_callocWasZero = isZero(m_calloc, m_size * 3);
        fill(m_calloc, m_size * 3, seed);

        m_grown = malloc(24);
        fill(m_grown, 24, seed);
        m_grown = realloc(m_grown, m_size + 70000);
        m_grownKeptBytes = holds(m_grown, 24, seed);
        fill(m_grown, m_size + 70000, seed);

        m_shrunk = malloc(m_size + 200000);
        fill(m_shrunk, m_size + 200000, seed);
        m_shrunk = realloc(m_shrunk, 24);

        m_large = malloc(largeSize);
        fill(m_large, largeSize, seed);

        if (posix_memalign(&m_memalign, 4096, m_size))
            m_memalign = nullptr;
        else
            fill(m_memalign, m_size, seed);

        m_alignedAlloc = aligned_alloc(64, 64 * (1 + m_size / 64));
        fill(m_alignedAlloc, m_size, seed);

        m_text = makeText(m_size % 3000 + 40, seed);
        m_strdup = strdup(m_text.c_str());
        m_strndup = strndup(m_text.c_str(), 20);
        if (asprintf(&m_asprintf, "%s|%u", m_text.c_str(), seed) < 0)
            m_asprintf = nullptr;
        m_getcwd = getcwd(nullptr, 0);
        m_realpath = realpath(".", nullptr);

        m_new = new unsigned char(byteAt(0, seed));
        m_newArray = new unsigned char[m_size];
        fill(m_newArray, m_size, seed);
        m_nothrowNew = new (std::nothrow) unsigned char[m_size];
        fill(m_nothrowNew, m_size, seed);
        m_alignedNew = new Aligned;
        fill(m_alignedNew->bytes, sizeof(Aligned::bytes), seed);
        m_alignedNewArray = new Aligned[3];
        for (int i = 0; i < 3; i++)
            fill(m_alignedNewArray[i].bytes, sizeof(Aligned::bytes), seed + i);

        // Members of std::string that the C++ library defines out of line.
        m_string.clear();
        m_string.shrink_to_fit();
        m_string.append(m_text);
        m_string.append(500, 'x');
        m_string.insert(0, m_text);
        m_string.replace(0, 10, m_text);
        m_string.reserve(m_string.size() * 4);
        m_string += m_text;
        m_string.resize(m_string.size() + 100, 'y');
        m_string.shrink_to_fit();
        m_stringLength = m_text.size() * 4 - 10 + 600;

        m_strings.clear();
        for (unsigned i = 0; i < 40; i++)
            m_strings.push_back(makeText(i * 9, seed) + std::to_string(i));

        m_map.clear();
        for (unsigned i = 0; i < 40; i++)
            m_map[makeText(30 + i, seed)].assign(i, static_cast<int>(seed));

        m_shared = std::make_shared<std::string>(m_text);
        std::shared_ptr<std::string> shared = m_shared;
        std::string copy = m_text;
        Aligned captured;
        fill(captured.bytes, sizeof(captured.bytes), seed);
        m_function = [shared, copy, captured] { return shared->size() + copy.size() + captured.bytes[0]; };

        std::ostringstream stream;
        stream << m_text << ' ' << seed << ' ' << 1.5 << ' ' << m_text;
        m_streamed = stream.str();

        try {
            throw std::runtime_error(m_text);
        } catch (...) {
            m_exception = std::current_exception();
        }
    }

    void release()
    {
        if (!m_allocated)
            return;
        m_allocated = false;
        unsigned seed = m_seed;

        check(holds(m_malloc, m_size, seed), "malloc");
        free(m_malloc);
        check(m_callocWasZero, "calloc (it was not zero)");
        check(holds(m_calloc, m_size * 3, seed), "calloc");
        free(m_calloc);
        check(m_grownKeptBytes, "realloc (growing lost bytes)");
        check(holds(m_grown, m_size + 70000, seed), "realloc to a larger size");
        free(m_grown);
        check(holds(m_shrunk, 24, seed), "realloc to a smaller size");
        free(m_shrunk);
        check(holds(m_large, largeSize, seed), "malloc of a large size");
        free(m_large);
        check(m_memalign && !(reinterpret_cast<uintptr_t>(m_memalign) % 4096) && holds(m_memalign, m_size, seed), "posix_memalign");
        free(m_memalign);
        check(!(reinterpret_cast<uintptr_t>(m_alignedAlloc) % 64) && holds(m_alignedAlloc, m_size, seed), "aligned_alloc");
        free(m_alignedAlloc);

        check(m_text == m_strdup, "strdup");
        free(m_strdup);
        check(!m_text.compare(0, 20, m_strndup), "strndup");
        free(m_strndup);
        check(m_asprintf && !m_text.compare(0, m_text.size(), m_asprintf, m_text.size()), "asprintf");
        free(m_asprintf);
        check(m_getcwd && m_getcwd[0] == '/', "getcwd");
        free(m_getcwd);
        check(m_realpath && m_realpath[0] == '/', "realpath");
        free(m_realpath);

        check(*m_new == byteAt(0, seed), "new");
        delete m_new;
        check(holds(m_newArray, m_size, seed), "new[]");
        delete[] m_newArray;
        check(holds(m_nothrowNew, m_size, seed), "new (std::nothrow)");
        delete[] m_nothrowNew;
        check(!(reinterpret_cast<uintptr_t>(m_alignedNew) % 128) && holds(m_alignedNew->bytes, sizeof(Aligned::bytes), seed), "aligned new");
        delete m_alignedNew;
        check(!(reinterpret_cast<uintptr_t>(m_alignedNewArray) % 128) && holds(m_alignedNewArray[2].bytes, sizeof(Aligned::bytes), seed + 2), "aligned new[]");
        delete[] m_alignedNewArray;

        check(m_string.size() == m_stringLength && !m_string.compare(0, m_text.size(), m_text), "std::string");
        std::string().swap(m_string);
        check(m_strings.size() == 40 && m_strings[39] == makeText(39 * 9, seed) + "39", "std::vector<std::string>");
        std::vector<std::string>().swap(m_strings);
        check(m_map.size() == 40 && m_map[makeText(69, seed)].size() == 39, "std::map");
        m_map.clear();
        check(m_function() == m_text.size() * 2 + byteAt(0, seed), "std::function");
        m_function = nullptr;
        check(*m_shared == m_text && m_shared.use_count() == 1, "std::shared_ptr");
        m_shared.reset();
        check(m_streamed.size() > m_text.size() * 2 && !m_streamed.compare(0, m_text.size(), m_text), "std::ostringstream");
        std::string().swap(m_streamed);
        try {
            std::rethrow_exception(m_exception);
        } catch (const std::runtime_error& error) {
            check(m_text == error.what(), "std::runtime_error");
        }
        m_exception = nullptr;
        std::string().swap(m_text);
    }

private:
    static constexpr size_t largeSize = 3 * 1024 * 1024 + 100;

    static bool isZero(const void* block, size_t size)
    {
        auto* bytes = static_cast<const unsigned char*>(block);
        for (size_t i = 0; i < size; i++) {
            if (bytes[i])
                return false;
        }
        return true;
    }

    void check(bool intact, const char* kind)
    {
        if (!intact)
            reportDamage(m_owner, kind);
    }

    const char* m_owner;
    bool m_allocated = false;
    bool m_callocWasZero = false;
    bool m_grownKeptBytes = false;
    unsigned m_seed = 0;
    size_t m_size = 0;
    size_t m_stringLength = 0;
    void* m_malloc = nullptr;
    void* m_calloc = nullptr;
    void* m_grown = nullptr;
    void* m_shrunk = nullptr;
    void* m_large = nullptr;
    void* m_memalign = nullptr;
    void* m_alignedAlloc = nullptr;
    char* m_strdup = nullptr;
    char* m_strndup = nullptr;
    char* m_asprintf = nullptr;
    char* m_getcwd = nullptr;
    char* m_realpath = nullptr;
    unsigned char* m_new = nullptr;
    unsigned char* m_newArray = nullptr;
    unsigned char* m_nothrowNew = nullptr;
    Aligned* m_alignedNew = nullptr;
    Aligned* m_alignedNewArray = nullptr;
    std::string m_text;
    std::string m_string;
    std::string m_streamed;
    std::vector<std::string> m_strings;
    std::map<std::string, std::vector<int>> m_map;
    std::shared_ptr<std::string> m_shared;
    std::function<size_t()> m_function;
    std::exception_ptr m_exception;
};

// Never destroyed: a thread may still take it while the process exits.
std::mutex& holderLock()
{
    static auto* lock = new std::mutex;
    return *lock;
}

// Blocks that one place releases when the process, the environment or the thread ends. Any thread may replace them
// until then.
class Holder {
public:
    explicit Holder(const char* place)
        : m_place(place)
        , m_blocks(place)
    {
        m_blocks.allocate(1);
    }

    void replaceBlocks(unsigned seed)
    {
        std::lock_guard<std::mutex> lock(holderLock());
        if (!m_released)
            m_blocks.allocate(seed);
    }

    void releaseBlocks()
    {
        {
            std::lock_guard<std::mutex> lock(holderLock());
            if (m_released)
                return;
            m_released = true;
            m_blocks.release();
        }
        announceRelease(m_place);
    }

private:
    const char* m_place;
    bool m_released = false;
    Blocks m_blocks;
};

struct StaticHolder : Holder {
    StaticHolder()
        : Holder("a static destructor")
    {
    }
    ~StaticHolder() { releaseBlocks(); }
};
StaticHolder staticHolder;

Holder* atexitHolder;

struct ThreadLocalHolder : Holder {
    ThreadLocalHolder()
        : Holder("a thread-local destructor")
    {
    }
    ~ThreadLocalHolder() { releaseBlocks(); }
};
thread_local ThreadLocalHolder threadLocalHolder;

std::atomic<unsigned> nextSeed { 2 };

// What belongs to one environment: the main thread has one, and so does each Worker that loads the addon.
struct Environment {
    Holder cleanupHook { "an environment cleanup hook" };
    Holder asyncCleanupHook { "an asynchronous cleanup hook" };
    Holder instanceData { "the finalizer of the instance data" };
    std::atomic<int> holdersLeft { 3 };

    void release(Holder& holder)
    {
        holder.releaseBlocks();
        if (!--holdersLeft)
            delete this;
    }
};

#define CALL(call)                                                     \
    do {                                                               \
        if ((call) != napi_ok) {                                       \
            writeLine(2, "this call did not return napi_ok: ", #call); \
            return nullptr;                                            \
        }                                                              \
    } while (0)

Environment* environmentOf(napi_env env)
{
    void* data = nullptr;
    napi_get_instance_data(env, &data);
    return static_cast<Environment*>(data);
}

uint32_t numberArgument(napi_env env, napi_callback_info info, uint32_t fallback)
{
    size_t count = 1;
    napi_value argument;
    uint32_t number = fallback;
    if (napi_get_cb_info(env, info, &count, &argument, nullptr, nullptr) != napi_ok || !count)
        return fallback;
    if (napi_get_value_uint32(env, argument, &number) != napi_ok)
        return fallback;
    return number;
}

// replaceHeldBlocks(rounds): releases what every holder holds and allocates it anew.
napi_value replaceHeldBlocks(napi_env env, napi_callback_info info)
{
    Environment* environment = environmentOf(env);
    for (uint32_t rounds = numberArgument(env, info, 1); rounds; rounds--) {
        staticHolder.replaceBlocks(nextSeed++);
        atexitHolder->replaceBlocks(nextSeed++);
        threadLocalHolder.replaceBlocks(nextSeed++);
        environment->cleanupHook.replaceBlocks(nextSeed++);
        environment->asyncCleanupHook.replaceBlocks(nextSeed++);
        environment->instanceData.replaceBlocks(nextSeed++);
    }
    return nullptr;
}

std::atomic<uint32_t> detachedThreadRounds { 0 };

// startDetachedThread(): the thread allocates and releases until the process is gone.
napi_value startDetachedThread(napi_env, napi_callback_info)
{
    std::thread([] {
        threadLocalHolder.replaceBlocks(nextSeed++);
        Blocks blocks("a detached thread");
        for (;;) {
            blocks.allocate(nextSeed++);
            blocks.release();
            detachedThreadRounds++;
        }
    }).detach();
    return nullptr;
}

napi_value countDetachedThreadRounds(napi_env env, napi_callback_info)
{
    napi_value result;
    CALL(napi_create_uint32(env, detachedThreadRounds.load(), &result));
    return result;
}

// runThreads(rounds): each of four threads releases what its neighbor allocated, and this thread releases the rest.
napi_value runThreads(napi_env env, napi_callback_info info)
{
    constexpr int threadCount = 4;
    for (uint32_t rounds = numberArgument(env, info, 1); rounds; rounds--) {
        std::vector<std::unique_ptr<Blocks>> made(threadCount);
        std::vector<std::unique_ptr<Blocks>> left(threadCount);
        std::vector<std::thread> threads;
        for (int i = 0; i < threadCount; i++) {
            threads.emplace_back([&made, i] {
                threadLocalHolder.replaceBlocks(nextSeed++);
                made[i] = std::make_unique<Blocks>("the thread beside the one that allocated");
                made[i]->allocate(nextSeed++);
            });
        }
        for (auto& thread : threads)
            thread.join();
        threads.clear();
        for (int i = 0; i < threadCount; i++) {
            threads.emplace_back([&made, &left, i] {
                made[(i + 1) % threadCount].reset();
                left[i] = std::make_unique<Blocks>("the thread that started the one that allocated");
                left[i]->allocate(nextSeed++);
            });
        }
        for (auto& thread : threads)
            thread.join();
    }
    return nullptr;
}

struct Work {
    napi_async_work handle = nullptr;
    uint32_t rounds = 0;
    Blocks blocks { "the completion of asynchronous work" };
};

std::atomic<uint32_t> completedWork { 0 };

// queueWork(rounds): allocates on a thread of the runtime's pool and releases the last blocks on this thread.
napi_value queueWork(napi_env env, napi_callback_info info)
{
    auto* work = new Work;
    work->rounds = numberArgument(env, info, 1);
    napi_value name;
    CALL(napi_create_string_utf8(env, "allocations", NAPI_AUTO_LENGTH, &name));
    CALL(napi_create_async_work(
        env, nullptr, name,
        [](napi_env, void* data) {
            auto* work = static_cast<Work*>(data);
            threadLocalHolder.replaceBlocks(nextSeed++);
            for (uint32_t i = 0; i < work->rounds; i++)
                work->blocks.allocate(nextSeed++);
        },
        [](napi_env env, napi_status, void* data) {
            auto* work = static_cast<Work*>(data);
            work->blocks.release();
            napi_delete_async_work(env, work->handle);
            delete work;
            completedWork++;
        },
        work, &work->handle));
    CALL(napi_queue_async_work(env, work->handle));
    return nullptr;
}

napi_value countCompletedWork(napi_env env, napi_callback_info)
{
    napi_value result;
    CALL(napi_create_uint32(env, completedWork.load(), &result));
    return result;
}

// Memory of the addon's that a JavaScript value refers to until the value's finalizer runs.
std::atomic<uint32_t> lentBlocks { 0 };
std::atomic<uint32_t> returnedBlocks { 0 };
// What returnedBlocks was when the script asked for a count of the finalizers that run as the environment ends.
std::atomic<int64_t> returnedBeforeTheEnd { -1 };

struct Loan {
    const char* kind;
    void* block;
    size_t size;
    unsigned seed;
    void (*release)(void*);
};

Loan* lend(const char* kind, void* block, size_t size, void (*release)(void*))
{
    unsigned seed = nextSeed++;
    fill(block, size, seed);
    lentBlocks++;
    return new Loan { kind, block, size, seed, release };
}

void takeBack(napi_env, void* data, void* hint)
{
    auto* loan = static_cast<Loan*>(hint);
    if (data != loan->block)
        writeLine(2, "the finalizer got another pointer than was lent for ", loan->kind);
    if (!holds(loan->block, loan->size, loan->seed))
        reportDamage("a finalizer", loan->kind);
    loan->release(loan->block);
    delete loan;
    returnedBlocks++;
}

// External strings hold text, so the bytes are kept in a range that both encodings store as they are.
void fillWithText(void* block, size_t size, unsigned seed)
{
    auto* bytes = static_cast<unsigned char*>(block);
    for (size_t i = 0; i < size; i++)
        bytes[i] = 'a' + (i + seed) % 26;
}

void takeBackText(napi_env, void* data, void* hint)
{
    auto* loan = static_cast<Loan*>(hint);
    auto* bytes = static_cast<unsigned char*>(loan->block);
    if (data != loan->block)
        writeLine(2, "the finalizer got another pointer than was lent for ", loan->kind);
    bool wide = !strcmp(loan->kind, "an external UTF-16 string");
    for (size_t i = 0; i < loan->size; i++) {
        unsigned unit = wide ? static_cast<char16_t*>(loan->block)[i] : bytes[i];
        if (unit != 'a' + (i + loan->seed) % 26) {
            reportDamage("a finalizer", loan->kind);
            break;
        }
    }
    loan->release(loan->block);
    delete loan;
    returnedBlocks++;
}

void releaseArray(void* block) { delete[] static_cast<unsigned char*>(block); }
void releaseAligned(void* block) { delete static_cast<Aligned*>(block); }

napi_value createExternalBuffer(napi_env env, napi_callback_info info)
{
    size_t size = numberArgument(env, info, 64);
    Loan* loan = lend("an external buffer", malloc(size), size, free);
    napi_value result;
    CALL(napi_create_external_buffer(env, size, loan->block, takeBack, loan, &result));
    return result;
}

napi_value createExternalArrayBuffer(napi_env env, napi_callback_info info)
{
    size_t size = numberArgument(env, info, 64);
    Loan* loan = lend("an external ArrayBuffer", new unsigned char[size], size, releaseArray);
    napi_value result;
    CALL(napi_create_external_arraybuffer(env, loan->block, size, takeBack, loan, &result));
    return result;
}

napi_value createExternalLatin1String(napi_env env, napi_callback_info info)
{
    size_t length = numberArgument(env, info, 64);
    Loan* loan = lend("an external Latin-1 string", calloc(length, 1), length, free);
    fillWithText(loan->block, length, loan->seed);
    napi_value result;
    bool copied = false;
    CALL(node_api_create_external_string_latin1(env, static_cast<char*>(loan->block), length, takeBackText, loan, &result, &copied));
    return result;
}

napi_value createExternalUTF16String(napi_env env, napi_callback_info info)
{
    size_t length = numberArgument(env, info, 64);
    void* block = nullptr;
    if (posix_memalign(&block, 64, length * sizeof(char16_t)))
        return nullptr;
    Loan* loan = lend("an external UTF-16 string", block, length, free);
    for (size_t i = 0; i < length; i++)
        static_cast<char16_t*>(block)[i] = 'a' + (i + loan->seed) % 26;
    napi_value result;
    bool copied = false;
    CALL(node_api_create_external_string_utf16(env, static_cast<char16_t*>(block), length, takeBackText, loan, &result, &copied));
    return result;
}

napi_value createExternal(napi_env env, napi_callback_info)
{
    Loan* loan = lend("an external value", new Aligned, sizeof(Aligned::bytes), releaseAligned);
    napi_value result;
    CALL(napi_create_external(env, loan->block, takeBack, loan, &result));
    return result;
}

napi_value objectArgument(napi_env env, napi_callback_info info)
{
    size_t count = 1;
    napi_value object = nullptr;
    napi_get_cb_info(env, info, &count, &object, nullptr, nullptr);
    return object;
}

napi_value wrapObject(napi_env env, napi_callback_info info)
{
    napi_value object = objectArgument(env, info);
    Loan* loan = lend("a wrapped object", strdup("a wrapped object holds this text"), 16, free);
    CALL(napi_wrap(env, object, loan->block, takeBack, loan, nullptr));
    return object;
}

napi_value addFinalizer(napi_env env, napi_callback_info info)
{
    napi_value object = objectArgument(env, info);
    Loan* loan = lend("an object with a finalizer", realloc(malloc(8), 5000), 5000, free);
    CALL(napi_add_finalizer(env, object, loan->block, takeBack, loan, nullptr));
    return object;
}

// Memory of the runtime's that the addon writes to. `seedOf(value)` in the script is the first byte.
napi_value createBufferCopy(napi_env env, napi_callback_info info)
{
    size_t size = numberArgument(env, info, 64);
    void* source = malloc(size);
    fill(source, size, 3);
    void* copy = nullptr;
    napi_value result;
    napi_status status = napi_create_buffer_copy(env, size, source, &copy, &result);
    memset(source, 0xee, size);
    free(source);
    CALL(status);
    if (!holds(copy, size, 3))
        reportDamage("napi_create_buffer_copy", "the runtime");
    return result;
}

napi_value createBuffer(napi_env env, napi_callback_info info)
{
    size_t size = numberArgument(env, info, 64);
    void* data = nullptr;
    napi_value result;
    CALL(napi_create_buffer(env, size, &data, &result));
    fill(data, size, 3);
    return result;
}

napi_value createArrayBuffer(napi_env env, napi_callback_info info)
{
    size_t size = numberArgument(env, info, 64);
    void* data = nullptr;
    napi_value result;
    CALL(napi_create_arraybuffer(env, size, &data, &result));
    fill(data, size, 3);
    return result;
}

// holdsWrittenBytes(view): whether memory that createBufferCopy, createBuffer or createArrayBuffer filled still reads
// the same from native code.
napi_value holdsWrittenBytes(napi_env env, napi_callback_info info)
{
    napi_value value = objectArgument(env, info);
    void* data = nullptr;
    size_t size = 0;
    bool isArrayBuffer = false;
    CALL(napi_is_arraybuffer(env, value, &isArrayBuffer));
    if (isArrayBuffer)
        CALL(napi_get_arraybuffer_info(env, value, &data, &size));
    else
        CALL(napi_get_buffer_info(env, value, &data, &size));
    napi_value result;
    CALL(napi_get_boolean(env, holds(data, size, 3), &result));
    return result;
}

napi_value countBlocksOnLoan(napi_env env, napi_callback_info)
{
    napi_value result;
    CALL(napi_create_uint32(env, lentBlocks.load() - returnedBlocks.load(), &result));
    return result;
}

// countFinalizersFromNow(): the finalizer of the instance data, which runs after the others, prints the count.
napi_value countFinalizersFromNow(napi_env, napi_callback_info)
{
    returnedBeforeTheEnd = returnedBlocks.load();
    return nullptr;
}

} // namespace

NAPI_MODULE_INIT()
{
    static std::once_flag once;
    std::call_once(once, [] {
        atexitHolder = new Holder("an atexit handler");
        atexit([] { atexitHolder->releaseBlocks(); });
    });
    threadLocalHolder.replaceBlocks(nextSeed++);

    auto* environment = new Environment;
    CALL(napi_set_instance_data(
        env, environment,
        [](napi_env, void* data, void*) {
            auto* environment = static_cast<Environment*>(data);
            environment->release(environment->instanceData);
            if (returnedBeforeTheEnd >= 0)
                writeLine(1, "finalizers that ran as the environment ended: ", std::to_string(returnedBlocks - returnedBeforeTheEnd).c_str());
        },
        nullptr));
    CALL(napi_add_env_cleanup_hook(
        env,
        [](void* data) {
            auto* environment = static_cast<Environment*>(data);
            environment->release(environment->cleanupHook);
        },
        environment));
    CALL(napi_add_async_cleanup_hook(
        env,
        [](napi_async_cleanup_hook_handle handle, void* data) {
            auto* environment = static_cast<Environment*>(data);
            environment->release(environment->asyncCleanupHook);
            napi_remove_async_cleanup_hook(handle);
        },
        environment, nullptr));

    const struct {
        const char* name;
        napi_callback function;
    } functions[] = {
        { "replaceHeldBlocks", replaceHeldBlocks },
        { "startDetachedThread", startDetachedThread },
        { "countDetachedThreadRounds", countDetachedThreadRounds },
        { "runThreads", runThreads },
        { "queueWork", queueWork },
        { "countCompletedWork", countCompletedWork },
        { "createExternalBuffer", createExternalBuffer },
        { "createExternalArrayBuffer", createExternalArrayBuffer },
        { "createExternalLatin1String", createExternalLatin1String },
        { "createExternalUTF16String", createExternalUTF16String },
        { "createExternal", createExternal },
        { "wrapObject", wrapObject },
        { "addFinalizer", addFinalizer },
        { "createBufferCopy", createBufferCopy },
        { "createBuffer", createBuffer },
        { "createArrayBuffer", createArrayBuffer },
        { "holdsWrittenBytes", holdsWrittenBytes },
        { "countBlocksOnLoan", countBlocksOnLoan },
        { "countFinalizersFromNow", countFinalizersFromNow },
    };
    for (auto& entry : functions) {
        napi_value function;
        CALL(napi_create_function(env, entry.name, NAPI_AUTO_LENGTH, entry.function, nullptr, &function));
        CALL(napi_set_named_property(env, exports, entry.name, function));
    }
    return exports;
}
