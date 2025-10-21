function f2() {
    const v5 = new URL("https://example.com/path");
    const v9 = Response("bigint");

    // Access Response.body FIRST - creates ReadableStream
    const body = v9.body;

    // Then trigger URL.pathname recursion - causes exception scope mismatch
    v5[Symbol.toPrimitive] = f2;
    v5.pathname = v5;
}

f2();
