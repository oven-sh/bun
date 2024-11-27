// these tests involve ensuring certain libraries are working correctly.  it
// should be preferred to write specific tests for the bugs that these libraries
// discovered, but it easy and still a reasonable idea to just test the library
// entirely.
import { devTest } from "../dev-server-harness";

// TODO: svelte server component example project
// Bugs discovered thanks to Svelte:
// - Valid circular import use.
// - Re-export `.e_import_identifier`, including live bindings.
// TODO: - something related to the wrong push function being called