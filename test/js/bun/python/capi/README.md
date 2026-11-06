# Tests of Python's C API (abi3t)

C sources, the scripts that use what they are compiled to, and what CPython 3.15 prints when it runs them.

- `NAME.c`: an extension, or (before there are modules) a library that `NAME.py` loads with `ctypes.PyDLL`.
- `NAME.py`: the script. It is given the path of what `NAME.c` was compiled to.
- `NAME.expected`: what CPython printed, with `NAME.c` compiled **against CPython's own headers** (`-DPy_TARGET_ABI3T=0x030f0000`).
- `include/`: the header that `NAME.c` is compiled with **here**. It is written for these tests, declares what Bun implements so far, and has none of CPython's
  text. In abi3t a header is declarations and a few macros: C sees the layout of no object.

`capi.test.ts` compiles each source with the machine's compiler (`$CC`, `cc`, `clang`, `gcc`), as `test/js/bun/ffi` does, and runs each script several times: as it comes,
and with options of JavaScriptCore that make the collector come at other times or make a cell that was freed too early show. It needs no CPython.

An object dies when a collection finds that nothing refers to it, not when the last reference goes. So a script calls `gc.collect()` before it looks whether something
has died; that changes nothing in CPython.

## Tools (they need a CPython 3.15 with its headers: `--oracle`, or `$PYTHON_ORACLE`)

    tools/update.py [NAME...]                 ask CPython again, and write the .expected files
    tools/update.py --ours BUN [NAME...]      compile against include/, run with Bun, show the differences; writes nothing
    tools/check_header.py                     include/declarations.h agrees with CPython's headers, and declares nothing that abi3t does not have
