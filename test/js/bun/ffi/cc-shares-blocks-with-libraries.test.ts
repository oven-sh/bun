import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isWindows, strictSystemAllocatorEnv, tempDir } from "harness";
import { join } from "path";

const systemCC = process.env.CC || Bun.which("cc") || Bun.which("clang") || Bun.which("gcc");

// TinyCC's setjmp/longjmp error handling conflicts with ASan.
test.skipIf(isWindows || isASAN || !systemCC)(
  "C compiled by cc() and a shared library release and resize each other's blocks",
  async () => {
    using dir = tempDir("cc-shares-blocks", {
      "library.c": /* c */ `
        #include <stdlib.h>
        #include <string.h>
        void* library_allocate(size_t size) { return memset(malloc(size), 3, size); }
        void* library_resize(void* block, size_t size) { return realloc(block, size); }
        void library_release(void* block) { free(block); }
      `,
      // No #include: the test does not depend on where the system's headers are.
      "program.c": /* c */ `
        void* malloc(unsigned long);
        void* calloc(unsigned long, unsigned long);
        void* realloc(void*, unsigned long);
        void free(void*);
        int posix_memalign(void**, unsigned long, unsigned long);
        char* strdup(const char*);
        void* dlopen(const char*, int);
        void* dlsym(void*, const char*);

        static unsigned char* fill(void* block, unsigned long size, unsigned char byte) {
          for (unsigned long i = 0; i < size; i++) ((unsigned char*)block)[i] = byte;
          return block;
        }

        static int holds(const unsigned char* block, unsigned long size, unsigned char byte) {
          for (unsigned long i = 0; i < size; i++) if (block[i] != byte) return 0;
          return 1;
        }

        // Returns 0, or the number of the step that failed.
        int exchange_blocks(const char* library_path, int rounds) {
          void* library = dlopen(library_path, 2);
          if (!library) return 1;
          void* (*library_allocate)(unsigned long) = dlsym(library, "library_allocate");
          void* (*library_resize)(void*, unsigned long) = dlsym(library, "library_resize");
          void (*library_release)(void*) = dlsym(library, "library_release");
          if (!library_allocate || !library_resize || !library_release) return 2;

          for (int round = 0; round < rounds; round++) {
            unsigned long size = round % 100 ? 1 + (round * 37) % 9000 : 3000000;
            unsigned char* block;
            void* aligned;

            library_release(fill(malloc(size), size, 1));

            block = library_resize(fill(calloc(size, 2), size * 2, 2), size * 5);
            if (!holds(block, size * 2, 2)) return 3;
            free(block);

            block = library_allocate(size);
            if (!holds(block, size, 3)) return 4;
            block = realloc(block, size * 5);
            if (!holds(block, size, 3)) return 5;
            library_release(block);

            block = realloc(fill(malloc(size), size, 4), size * 5);
            if (!holds(block, size, 4)) return 6;
            library_release(block);

            free(library_allocate(size));

            if (posix_memalign(&aligned, 4096, size)) return 7;
            library_release(fill(aligned, size, 5));

            library_release(strdup("text"));
          }
          return 0;
        }
      `,
      "run.js": /* js */ `
        const { cc } = require("bun:ffi");
        const { symbols } = cc({
          source: require("path").join(__dirname, "program.c"),
          symbols: { exchange_blocks: { args: ["ptr", "int"], returns: "int" } },
        });
        console.log("failed step:", symbols.exchange_blocks(Buffer.from(process.argv[2] + "\\0"), 2000));
      `,
    });
    const library = join(String(dir), "library.so");

    await using compile = Bun.spawn({
      cmd: [systemCC!, "-shared", "-fPIC", "-o", library, join(String(dir), "library.c")],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect({ stderr: await compile.stderr.text(), exitCode: await compile.exited }).toEqual({
      stderr: expect.not.stringContaining("error"),
      exitCode: 0,
    });

    for (const env of [bunEnv, { ...bunEnv, ...strictSystemAllocatorEnv }]) {
      await using run = Bun.spawn({
        cmd: [bunExe(), join(String(dir), "run.js"), library],
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([run.stdout.text(), run.stderr.text(), run.exited]);
      expect({ stdout, stderr, exitCode, signalCode: run.signalCode }).toEqual({
        stdout: "failed step: 0\n",
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    }
  },
);
