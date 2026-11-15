import { holdProgramsOfSuites } from "../harness/runner-suites";

holdProgramsOfSuites(
  "test/bundler/bundler_barrel.test.ts",
  "test/bundler/bundler_bun.test.ts",
  "test/bundler/bundler_compile_autoload.test.ts",
  "test/bundler/bundler_compile_splitting.test.ts",
  "test/bundler/bundler_html_server.test.ts",
  "test/bundler/bundler_import_meta_glob.test.ts",
  "test/bundler/compile-argv.test.ts",
);
