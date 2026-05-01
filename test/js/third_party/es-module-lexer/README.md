## es-module-lexer test

The purpose of this test is to check that event loop tasks scheduled from
JavaScriptCore (rather than Bun) keep the process alive.

The problem used to be that Bun may close prematurely when async work was
scheduled by JavaScriptCore (rather than IO work).

At the time of writing, that list is:

- WebAssembly compilation
- Atomics

FinalizationRegistry is also scheduled by JSC, but that doesn't need to keep the process alive.
