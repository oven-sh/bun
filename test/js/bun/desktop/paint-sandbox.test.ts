import { test } from "bun:test";
import { isLinux } from "harness";

if (isLinux) await import("./paint.test.ts?sandbox");
else test.todo("pages in a sandbox");
