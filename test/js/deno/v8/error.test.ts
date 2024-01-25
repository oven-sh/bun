// GENERATED - DO NOT EDIT
// Copyright 2018+ the Deno authors. All rights reserved. MIT license.
// https://raw.githubusercontent.com/denoland/deno/main/cli/tests/unit/error_stack_test.ts
import { createDenoTest } from "deno:harness";
const { test, assertEquals, assertMatch } = createDenoTest(import.meta.path);
test.ignore(function errorStackMessageLine() {
    const e1 = new Error();
    e1.name = "Foo";
    e1.message = "bar";
    assertMatch(e1.stack!, /^Foo: bar\n/);
    const e2 = new Error();
    e2.name = "";
    e2.message = "bar";
    assertMatch(e2.stack!, /^bar\n/);
    const e3 = new Error();
    e3.name = "Foo";
    e3.message = "";
    assertMatch(e3.stack!, /^Foo\n/);
    const e4 = new Error();
    e4.name = "";
    e4.message = "";
    assertMatch(e4.stack!, /^\n/);
    const e5 = new Error();
    e5.name = undefined;
    e5.message = undefined;
    assertMatch(e5.stack!, /^Error\n/);
    const e6 = new Error();
    e6.name = null;
    e6.message = null;
    assertMatch(e6.stack!, /^null: null\n/);
});
test.ignore(function captureStackTrace() {
    function foo() {
        const error = new Error();
        const stack1 = error.stack!;
        Error.captureStackTrace(error, foo);
        const stack2 = error.stack!;
        assertEquals(stack2, stack1.replace(/(?<=^[^\n]*\n)[^\n]*\n/, ""));
    }
    foo();
});
