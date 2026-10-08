// https://github.com/babel/babel/pull/10148

%DebugPrint(foo);


// Invalid code https://github.com/JLHwung/babel/blob/c1a3cbfd65e08b7013fd6f8c62add8cb10b4b169/packages/babel-parser/test/fixtures/v8intrinsic/_errors/in-bind-expression/options.json
// ::%DebugPrint(null)

// Invalid code https://github.com/JLHwung/babel/blob/c1a3cbfd65e08b7013fd6f8c62add8cb10b4b169/packages/babel-parser/test/fixtures/v8intrinsic/_errors/in-member-expression/options.json
// a.%DebugPrint();

// Invalid code https://github.com/JLHwung/babel/blob/c1a3cbfd65e08b7013fd6f8c62add8cb10b4b169/packages/babel-parser/test/fixtures/v8intrinsic/_errors/not-in-call-expression/options.json
// const i = %DebugPrint;
// i(foo);

// https://github.com/JLHwung/babel/blob/c1a3cbfd65e08b7013fd6f8c62add8cb10b4b169/packages/babel-parser/test/fixtures/v8intrinsic/_errors/not-in-call-expression/options.json
// %DebugPrint?.(null)

new %DebugPrint(null);

function *foo() {
  yield %StringParseInt("42", 10)
}

foo%bar()
