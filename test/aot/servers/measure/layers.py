#!/usr/bin/env python3
"""Charges the samples of a `perf report` to the layer that owns the code they fell in.

    perf record -e cycles:u -c 250007 -o perf.data -p <pid of the server> -- <load>
    perf report -i perf.data --stdio --sort dso,symbol -n -F sample,dso,symbol --percent-limit 0 -g none > aot.txt
    python3 layers.py aot=aot.txt jit=jit.txt go=go.txt rust=rust.txt

An --aot executable names its compiled code for perf when it runs with BUN_JSC_useAOTPerfMap=1. The executable must not be
stripped. A kind other than Bun is chosen by the column's name: `go`, `rust`, or `stripped` after a colon (`released:stripped=..`).

The layers of a Bun executable:

    application         compiled TypeScript and JavaScript of the program and its packages; under a JIT, all code made at run time
    stubs               shared out-of-line code that compiled code calls or jumps to (--aot only)
    modules             Bun's own modules (node:*, bun:*, internal:*) and the engine's built-ins written in JavaScript, compiled (--aot only)
    native              Bun's native code: HTTP server, sockets, event loop, Web APIs, SQL driver, bindings, and the libraries linked into it
    interpreter         the bytecode interpreter: under --aot, code made from text at run time (`new Function`, `eval`)
    engine              JavaScriptCore and WTF: C++ run-time functions, strings, objects, promises, calls in and out of compiled code
    icu                 ICU
    gc                  marking, sweeping, allocation slow paths of the garbage-collected heap
    malloc              malloc and free
    libc                memmove, memchr, memset and the rest of libc

For Go and Rust: `application` is the program's own package or crate, `native` its libraries, `engine` the language's run time and
standard library, `gc` Go's collector (for Rust: destructors), `malloc` the allocator.
"""
import bisect, collections, re, sys

LAYERS = ["application", "stubs", "modules", "interpreter", "native", "engine", "icu", "gc", "malloc", "libc"]
TITLES = {
    "application": "application code (compiled TypeScript | JIT code | Go | Rust)",
    "stubs": "stubs of compiled code",
    "modules": "Bun's JavaScript modules and JavaScript built-ins, compiled",
    "interpreter": "the bytecode interpreter (code made from text at run time)",
    "native": "Bun's native code | the rival's libraries",
    "engine": "the engine's C++ | the rival's run time and standard library",
    "icu": "ICU",
    "gc": "GC",
    "malloc": "malloc and free",
    "libc": "libc (memmove, memchr ..)",
}

GC = re.compile(
    r"SlotVisitor|visitChildren|LayoutVisitor|MarkStack|[Ss]weep|ConservativeRoots|JSC::Heap::|JSC::Heap\b|Collector|MarkingConstraint|WeakBlock|WeakSet|WeakImpl|GCActivity"
    r"|stopAllocating|resumeAllocating|FreeList|BlockDirectory|MarkedBlock|MarkedSpace|visitButterfly|visitOutOfLine|visitBeside|LocalAllocator|allocateSlowCase|Subspace|PreciseAllocation"
    r"|IsoCellSet|HandleSet|HandleBlock|CodeBlockSet|JITStubRoutineSet|MachineThreads|GCThread|ParallelHelper|ParallelSource|JSString::destroy|JSCell.*::destroy|::destroy\(JSC::JSCell|DeferGC|GCDeferral|writeBarrier|WriteBarrierSlow|addToRememberedSet|CellContainer|AlignedMemoryAllocator|GigacageAligned"
)
MALLOC = re.compile(
    r"^_?mi_|^bmalloc|bmalloc::|^pas_|^bmalloc_|operator new|operator delete|fastMalloc|fastFree|fastRealloc|fastZeroedMalloc|fastAlignedMalloc|^(malloc|free|calloc|realloc|cfree|posix_memalign|aligned_alloc)$"
    r"|^_int_(malloc|free|realloc)|^__libc_(malloc|free|calloc|realloc)|malloc_consolidate|^__rust_(alloc|dealloc|realloc)|^__rdl_|^__rustc|tcache|unlink_chunk|sysmalloc"
)
ENGINE = re.compile(r"JSC::|WTF::|^JSC|^WTF|Inspector::|^operation|^vmEntry|^llint_|^jsc_|^aot|AOT|^Gigacage|^ctiMasm|^wasm|arityFixup|^handleUncaught|_ZN3JSC|_ZN3WTF|_ZNK3JSC|_ZNK3WTF|_ZZN3WTF|_ZZN3JSC")
BINDINGS = re.compile(r"^Bun::|^Zig::|^WebCore::|^Bun__|^JSC__|^WebCore__|^Zig__|^bun::|^uWS::|^us_|^uws_|^bsd_")
LIBC = ("libc", "ld-", "libm", "[vdso]", "libpthread", "libgcc", "libstdc++", "libdl")


def bun(dso, symbol):
    if dso.startswith(("[JIT]", "/tmp/perf-", "//anon", "[anon", "[unknown]", "[heap]", "[stack]")):
        if symbol.startswith(("(stub", "stub ")):
            return "stubs"
        where = re.search(r" (\S*):\d+$", symbol)
        if not where:
            return "application"
        return "modules" if not where.group(1) or where.group(1).startswith(("internal:", "node:", "bun:", "builtin")) else "application"
    if MALLOC.search(symbol):
        return "malloc"
    if dso.startswith(LIBC):
        return "libc"
    if re.match(r"icu_\d+::|u[a-z]+_\d+$|u[a-z0-9]+_[a-zA-Z0-9]+_\d+$", symbol):
        return "icu"
    if BINDINGS.search(symbol):
        return "native"
    if symbol.startswith(("llint_", "JSC::LLInt::")):
        return "interpreter"
    if GC.search(symbol):
        return "gc"
    if ENGINE.search(symbol):
        return "engine"
    return "native"


def stripped(dso, symbol):
    layer = bun(dso, symbol)
    return layer if layer in ("application", "libc") else "native"


def go(dso, symbol):
    if dso.startswith(LIBC):
        return "libc"
    if symbol.startswith("main."):
        return "application"
    if re.match(r"runtime\.(mallocgc\w*|newobject|makeslice\w*|growslice|makemap\w*|newarray|nextFreeFast|\(\*mcache\)|\(\*mcentral\)|\(\*mheap\)\.alloc\w*|rawstring|rawbyteslice|makechan|\(\*mspan\)\.(init|next\w*|refill)|publicationBarrier|deductAssistCredit|profilealloc|heapSetType\w*|\(\*mspan\)\.writeHeapBits\w*|allocm|persistentalloc\w*|\(\*fixalloc\))", symbol):
        return "malloc"
    if re.match(r"runtime\.(gc\w*|scan\w*|mark\w*|sweep\w*|greyobject|findObject|wb\w*|bulkBarrier\w*|\(\*gc\w+\)|\(\*sweep\w+\)|\(\*mspan\)|spanOf\w*|\(\*mheap\)|\(\*pageAlloc\)|\(\*pallocData\)|bgsweep|bgscavenge|typePointers|heapBits\w*|\(\*limiterEvent\)|tryDeferToSpanScan|\(\*spanInlineMarkBits\)|spanSetScans|\(\*lfstack\)|\(\*spanQueue\)|\(\*localSpanQueue\)|\(\*objptr|\(\*activeSweep\)|\(\*scavenge\w*|\(\*atomicHeadTailIndex\)|\(\*spanSet\)|\(\*stackScanState\)|getempty|putempty|putfull|trygetfull|handoff|pollFractional\w*|addspecial|removespecial|freespecial)|gcWriteBarrier|internal/runtime/gc", symbol):
        return "gc"
    if re.match(r"runtime\.(memmove|memequal\w*|cmpstring|memclr\w*|indexbyte\w*|countbody)|^(memeqbody|cmpbody|indexbytebody|indexbody|countbody)|internal/bytealg", symbol):
        return "libc"
    if re.match(r"github\.com/|golang\.org/|net/http|encoding/json|database/sql", symbol):
        return "native"
    return "engine"


def rust(dso, symbol):
    if MALLOC.search(symbol) or re.search(r"alloc::raw_vec|RawVec|alloc::alloc|finish_grow|do_reserve|mimalloc", symbol):
        return "malloc"
    if dso.startswith(LIBC):
        return "libc"
    if re.search(r"drop_in_place|::drop\b|drop_slow|as core::ops::drop::Drop", symbol):
        return "gc"
    if re.search(r"\b(axum|hyper|tower|tokio|tokio_postgres|postgres_protocol|postgres_types|deadpool\w*|serde\w*|http|httparse|http_body\w*|matchit|mio|socket2|bytes|futures\w*|itoa|ryu|memchr|form_urlencoded|percent_encoding|hashbrown|rustc_hash|parking_lot\w*|smallvec|slab|want|fallible_iterator|stringprep|phf|sha2|hmac|regex\w*)::", symbol):
        first = re.match(r"<?&?(mut )?(\w+)::", symbol)
        return "native" if not first or first.group(2) not in ("tracker", "pieces", "servers", "backend") else "application"
    if re.search(r"\b(tracker|pieces|servers|backend)::", symbol):
        return "application"
    return "engine"


KINDS = {"go": go, "rust": rust, "stripped": stripped}


def read_report(path, kind=bun):
    """Takes a file name or lines. Returns the number of samples by layer, and by (layer, symbol)."""
    by_layer, by_symbol = collections.Counter(), collections.Counter()
    for line in open(path, errors="replace") if isinstance(path, str) else path:
        match = re.match(r"\s*(\d+)\s+(.+?)\s+\[[.kHuG]\]\s+(.*?)(\s+-\s+-\s*)?$", line.rstrip("\n"))
        if match:
            samples, dso, symbol = int(match.group(1)), match.group(2).strip(), match.group(3).strip()
            if symbol.startswith("0xffffffff"):
                continue
            layer = kind(dso, symbol)
            by_layer[layer] += samples
            by_symbol[layer, symbol] += samples
    return by_layer, by_symbol


def count_stubs(addresses, perf_map, image_map):
    """Charges sampled addresses that fall into the stubs to the single stubs. Returns the number of samples by stub.

    perf_map is /tmp/perf-<pid>.map, which says where the copies of the stubs lie. image_map is the file that
    `bun build --compile --aot` writes when BUN_JSC_aotMapFilePath is set; its T lines have every stub's offset and name.
    Variants of a stub that differ in a number or in the registers they keep are counted as one.
    Without addresses (a column that is not an --aot build has neither file) the count is empty and no file is opened."""
    if not addresses:
        return collections.Counter()
    stubs = sorted((int(fields[1]), fields[2]) for fields in (line.rstrip("\n").split("\t") for line in open(image_map, errors="replace")) if fields[0] == "T")
    offsets = [offset for offset, _ in stubs]
    copies = sorted((int(start, 16), int(start, 16) + int(size, 16)) for start, size, name in (line.rstrip("\n").split(" ", 2) for line in open(perf_map, errors="replace")) if name.startswith("(stubs"))
    starts = [start for start, _ in copies]
    by_stub = collections.Counter()
    for address in addresses:
        copy = bisect.bisect_right(starts, address) - 1
        if copy >= 0 and address < copies[copy][1]:
            name = stubs[max(0, bisect.bisect_right(offsets, address - starts[copy]) - 1)][1]
            by_stub[re.sub(r"\d+", "N", re.sub(r"(KeepingTwo|PreservingTwo|WithReceiverIn\w+| with arguments$)", "", name))] += 1
    return by_stub


def read_call_chains(lines):
    """Takes the output of `perf script -F ip,sym,dso` for a profile with call chains. Returns samples by (layer, who asked).

    Who asked is the nearest compiled function up the stack: "application", "modules", or "nobody" where native code ran on its
    own (the event loop, the HTTP parser, GC threads). A stub has no frame of its own, so a sample in a stub is charged to the
    caller of the function that called it; that is the same layer except at the outermost function of a layer."""
    counts, chain = collections.Counter(), []
    for line in list(lines) + [""]:
        match = re.match(r"\s*[0-9a-f]+ (.*) \((.*)\)$", line.rstrip("\n"))
        if match:
            chain.append(bun(match.group(2).rsplit("/", 1)[-1] if not match.group(2).startswith("/tmp/perf-") else match.group(2), re.sub(r"\+0x[0-9a-f]+$", "", match.group(1))))
        elif chain:
            counts[chain[0], next((layer for layer in chain if layer in ("application", "modules")), "nobody")] += 1
            chain = []
    return counts


def kind_of(name):
    name, _, kind = name.partition(":")
    return KINDS.get(kind or name.split(".")[0], bun)


def main():
    heaviest = 0
    columns = []
    for word in sys.argv[1:]:
        if word.startswith("--heaviest="):
            heaviest = int(word.split("=")[1])
            continue
        name, _, path = word.partition("=")
        columns.append((name.partition(":")[0], *read_report(path, kind_of(name))))
    print("| layer, share of samples | " + " | ".join(name for name, _, _ in columns) + " |\n|---|" + "---:|" * len(columns))
    for layer in LAYERS:
        if any(by_layer[layer] for _, by_layer, _ in columns):
            print("| %s | " % TITLES[layer] + " | ".join("%.1f%%" % (100 * by_layer[layer] / sum(by_layer.values())) if by_layer[layer] else "" for _, by_layer, _ in columns) + " |")
    for name, by_layer, by_symbol in columns if heaviest else []:
        total = sum(by_layer.values())
        for layer in LAYERS:
            print("\n%s, %s:" % (name, layer))
            for (_, symbol), samples in [each for each in by_symbol.most_common() if each[0][0] == layer][:heaviest]:
                print("  %5.2f%%  %s" % (100 * samples / total, symbol[:140]))


if __name__ == "__main__":
    main()
