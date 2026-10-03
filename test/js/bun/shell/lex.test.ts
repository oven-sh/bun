import { $ } from "bun";
import { shellInternals } from "bun:internal-for-testing";
import { createTestBuilder, redirect } from "./util";
const { lex } = shellInternals;
const TestBuilder = createTestBuilder(import.meta.path);

const BUN = process.argv0;

$.nothrow();

describe("lex shell", () => {
  test("basic", () => {
    const expected = [{ "Text": "next" }, { "Delimit": {} }, { "Text": "dev" }, { "Delimit": {} }, { "Eof": {} }];
    const result = JSON.parse(lex`next dev`);
    expect(result).toEqual(expected);
  });

  test("var edgecase", () => {
    expect(JSON.parse(lex`$PWD/test.txt`)).toEqual([
      { "Var": "PWD" },
      { "Text": "/test.txt" },
      { "Delimit": {} },
      { "Eof": {} },
    ]);
  });

  test("vars", () => {
    const expected = [
      { "Text": "next" },
      { "Delimit": {} },
      { "Text": "dev" },
      { "Delimit": {} },
      { "Var": "PORT" },
      { "Eof": {} },
    ];
    const result = JSON.parse(lex`next dev $PORT`);
    expect(result).toEqual(expected);
  });

  test("quoted_var", () => {
    const expected = [
      { "Text": "next" },
      { "Delimit": {} },
      { "Text": "dev" },
      { "Delimit": {} },
      { "Var": "PORT" },
      { "Eof": {} },
    ];
    const result = JSON.parse(lex`next dev "$PORT"`);
    expect(result).toEqual(expected);
  });

  test("quoted_edge_case", () => {
    const expected = [
      { "Text": "next" },
      { "Delimit": {} },
      { "Text": "dev" },
      { "Delimit": {} },
      { "Text": "foo" },
      { "Var": "PORT" },
      { "Eof": {} },
    ];
    const result = JSON.parse(lex`next dev foo"$PORT"`);
    expect(result).toEqual(expected);
  });

  test("quote_multi", () => {
    const expected = [
      { "Text": "echo" },
      { "Delimit": {} },
      { "Text": "foo" },
      { "Var": "NICE" },
      { "Text": "good" },
      { "DoubleQuotedText": "NICE" },
      { "Eof": {} },
    ];
    const result = JSON.parse(lex`echo foo"$NICE"good"NICE"`);
    expect(result).toEqual(expected);
  });

  test("semicolon", () => {
    const expected = [
      { "Text": "echo" },
      { "Delimit": {} },
      { "Text": "foo" },
      { "Delimit": {} },
      { "Semicolon": {} },
      { "Text": "bar" },
      { "Delimit": {} },
      { "Text": "baz" },
      { "Delimit": {} },
      { "Semicolon": {} },
      { "Text": "echo" },
      { "Delimit": {} },
      { "DoubleQuotedText": "NICE;" },
      { "Eof": {} },
    ];
    const result = JSON.parse(lex`echo foo; bar baz; echo "NICE;"`);
    expect(result).toEqual(expected);
  });

  test("single_quote", () => {
    const expected = [
      { "Text": "next" },
      { "Delimit": {} },
      { "Text": "dev" },
      { "Delimit": {} },
      { "SingleQuotedText": "hello how is it going" },
      { "Eof": {} },
    ];
    const result = JSON.parse(lex`next dev 'hello how is it going'`);
    expect(result).toEqual(expected);
  });

  test("env_vars", () => {
    const expected = [
      { "Text": "NAME=zack" },
      { "Delimit": {} },
      { "Text": "FULLNAME=" },
      { "Var": "NAME" },
      { "DoubleQuotedText": " radisic" },
      { "Delimit": {} },
      { "Text": "LOL=" },
      { "Delimit": {} },
      { "Semicolon": {} },
      { "Text": "echo" },
      { "Delimit": {} },
      { "Var": "FULLNAME" },
      { "Eof": {} },
    ];
    const result = JSON.parse(lex`NAME=zack FULLNAME="$NAME radisic" LOL= ; echo $FULLNAME`);
    expect(result).toEqual(expected);
  });

  test("env_vars2", () => {
    const expected = [
      {
        Text: "NAME=zack",
      },
      {
        Delimit: {},
      },
      {
        Text: "foo=",
      },
      {
        Var: "bar",
      },
      { Delimit: {} },
      {
        Text: "echo",
      },
      {
        Delimit: {},
      },
      {
        Var: "NAME",
      },
      {
        Eof: {},
      },
    ];
    const result = JSON.parse(lex`NAME=zack foo=$bar echo $NAME`);
    expect(result).toEqual(expected);
  });

  test("env_vars exported", () => {
    const expected = [
      {
        Text: "export",
      },
      {
        Delimit: {},
      },
      {
        Text: "NAME=zack",
      },
      {
        Delimit: {},
      },
      {
        Text: "FOO=bar",
      },
      {
        Delimit: {},
      },
      {
        Text: "export",
      },
      {
        Delimit: {},
      },
      {
        Text: "NICE=lmao",
      },
      {
        Delimit: {},
      },
      {
        Eof: {},
      },
    ];
    const result = JSON.parse(lex`export NAME=zack FOO=bar export NICE=lmao`);
    // console.log(result);
    expect(result).toEqual(expected);
  });

  test("brace_expansion", () => {
    const expected = [
      { "Text": "echo" },
      { "Delimit": {} },
      { "BraceBegin": {} },
      { "Text": "ts" },
      { "Comma": {} },
      { "Text": "tsx" },
      { "Comma": {} },
      { "Text": "js" },
      { "Comma": {} },
      { "Text": "jsx" },
      { "BraceEnd": {} },
      { "Eof": {} },
    ];
    const result = JSON.parse(lex`echo {ts,tsx,js,jsx}`);
    expect(result).toEqual(expected);
  });

  test("op_and", () => {
    const expected = [
      { "Text": "echo" },
      { "Delimit": {} },
      { "Text": "foo" },
      { "Delimit": {} },
      { "DoubleAmpersand": {} },
      { "Text": "echo" },
      { "Delimit": {} },
      { "Text": "bar" },
      { "Delimit": {} },
      { "Eof": {} },
    ];
    const result = JSON.parse(lex`echo foo && echo bar`);
    expect(result).toEqual(expected);
  });

  test("op_or", () => {
    const expected = [
      { "Text": "echo" },
      { "Delimit": {} },
      { "Text": "foo" },
      { "Delimit": {} },
      { "DoublePipe": {} },
      { "Text": "echo" },
      { "Delimit": {} },
      { "Text": "bar" },
      { "Delimit": {} },
      { "Eof": {} },
    ];
    const result = JSON.parse(lex`echo foo || echo bar`);
    expect(result).toEqual(expected);
  });

  test("op_pipe", () => {
    const expected = [
      { "Text": "echo" },
      { "Delimit": {} },
      { "Text": "foo" },
      { "Delimit": {} },
      { "Pipe": {} },
      { "Text": "echo" },
      { "Delimit": {} },
      { "Text": "bar" },
      { "Delimit": {} },
      { "Eof": {} },
    ];
    const result = JSON.parse(lex`echo foo | echo bar`);
    expect(result).toEqual(expected);
  });

  test("op_bg", () => {
    const expected = [
      { "Text": "echo" },
      { "Delimit": {} },
      { "Text": "foo" },
      { "Delimit": {} },
      { "Ampersand": {} },
      { "Text": "echo" },
      { "Delimit": {} },
      { "Text": "bar" },
      { "Delimit": {} },
      { "Eof": {} },
    ];
    const result = JSON.parse(lex`echo foo & echo bar`);
    expect(result).toEqual(expected);
  });

  test("op_redirect", () => {
    let expected = [
      { "Text": "echo" },
      { "Delimit": {} },
      { "Text": "foo" },
      { "Delimit": {} },
      {
        "Redirect": redirect({ stdout: true }),
      },
      { "Text": "cat" },
      { "Delimit": {} },
      { "Text": "secrets.txt" },
      { "Delimit": {} },
      { "Eof": {} },
    ];
    let result = JSON.parse(lex`echo foo > cat secrets.txt`);
    expect(result).toEqual(expected);

    expected = [
      { "Text": "cmd1" },
      { "Delimit": {} },
      {
        "Redirect": {
          "stdin": true,
          "stdout": false,
          "stderr": false,
          "append": false,
          duplicate_out: false,
          "__unused": 0,
        },
      },
      { "Text": "file.txt" },
      { "Delimit": {} },
      { "Eof": {} },
    ];
    result = lex`cmd1 0> file.txt`;
    expect(JSON.parse(result)).toEqual(expected);

    expected = [
      { "Text": "cmd1" },
      { "Delimit": {} },
      {
        "Redirect": {
          "stdin": false,
          "stdout": true,
          "stderr": false,
          "append": false,
          duplicate_out: false,
          "__unused": 0,
        },
      },
      { "Text": "file.txt" },
      { "Delimit": {} },
      { "Eof": {} },
    ];
    result = lex`cmd1 1> file.txt`;
    expect(JSON.parse(result)).toEqual(expected);

    expected = [
      { "Text": "cmd1" },
      { "Delimit": {} },
      {
        "Redirect": {
          "stdin": false,
          "stdout": false,
          "stderr": true,
          "append": false,
          duplicate_out: false,
          "__unused": 0,
        },
      },
      { "Text": "file.txt" },
      { "Delimit": {} },
      { "Eof": {} },
    ];
    result = lex`cmd1 2> file.txt`;
    expect(JSON.parse(result)).toEqual(expected);

    expected = [
      { "Text": "cmd1" },
      { "Delimit": {} },
      {
        "Redirect": {
          "stdin": false,
          "stdout": true,
          "stderr": true,
          "append": false,
          duplicate_out: false,
          "__unused": 0,
        },
      },
      { "Text": "file.txt" },
      { "Delimit": {} },
      { "Eof": {} },
    ];
    result = lex`cmd1 &> file.txt`;
    expect(JSON.parse(result)).toEqual(expected);

    expected = [
      { "Text": "cmd1" },
      { "Delimit": {} },
      {
        "Redirect": {
          "stdin": false,
          "stdout": true,
          "stderr": false,
          "append": true,
          duplicate_out: false,
          "__unused": 0,
        },
      },
      { "Text": "file.txt" },
      { "Delimit": {} },
      { "Eof": {} },
    ];
    result = lex`cmd1 1>> file.txt`;
    expect(JSON.parse(result)).toEqual(expected);

    expected = [
      { "Text": "cmd1" },
      { "Delimit": {} },
      {
        "Redirect": {
          "stdin": false,
          "stdout": false,
          "stderr": true,
          "append": true,
          duplicate_out: false,
          "__unused": 0,
        },
      },
      { "Text": "file.txt" },
      { "Delimit": {} },
      { "Eof": {} },
    ];
    result = lex`cmd1 2>> file.txt`;
    expect(JSON.parse(result)).toEqual(expected);

    expected = [
      { "Text": "cmd1" },
      { "Delimit": {} },
      {
        "Redirect": {
          "stdin": false,
          "stdout": true,
          "stderr": true,
          "append": true,
          duplicate_out: false,
          "__unused": 0,
        },
      },
      { "Text": "file.txt" },
      { "Delimit": {} },
      { "Eof": {} },
    ];
    result = lex`cmd1 &>> file.txt`;
    expect(JSON.parse(result)).toEqual(expected);
  });

  describe("where a word ends", () => {
    const tokens = (script: string) => JSON.parse(lex`${{ raw: script }}`);
    const text = (s: string) => ({ Text: s });
    const delimit = { Delimit: {} };
    const eof = { Eof: {} };
    const stdin = { Redirect: redirect({ stdin: true }) };
    const stdout = { Redirect: redirect({ stdout: true }) };
    const stderr = { Redirect: redirect({ stderr: true }) };
    const echo = [text("echo"), delimit];
    const toFile = [text("f"), delimit, eof];
    const echoZ = [...echo, { CmdSubstBegin: {} }, ...echo, text("z"), delimit, { CmdSubstEnd: {} }];

    // https://github.com/oven-sh/bun/issues/12602
    test.each([
      [
        "cp a b2>log",
        [text("cp"), delimit, text("a"), delimit, text("b2"), delimit, stdout, text("log"), delimit, eof],
      ],
      ["./script1<file", [text("./script1"), delimit, stdin, text("file"), delimit, eof]],
      ["./script0<file", [text("./script0"), delimit, stdin, text("file"), delimit, eof]],
      ["echo z0>f", [...echo, text("z0"), delimit, stdout, ...toFile]],
      ["echo z1>>f", [...echo, text("z1"), delimit, { Redirect: redirect({ stdout: true, append: true }) }, ...toFile]],
      ["echo a\\ 2>f", [...echo, text("a 2"), delimit, stdout, ...toFile]],
      ['echo "a"2>f', [...echo, { DoubleQuotedText: "a" }, text("2"), delimit, stdout, ...toFile]],
      ["echo 'a'2>f", [...echo, { SingleQuotedText: "a" }, text("2"), delimit, stdout, ...toFile]],
      ['echo ""2>f', [...echo, { DoubleQuotedText: "" }, text("2"), delimit, stdout, ...toFile]],
      ["echo $12>f", [...echo, { VarArgv: 1 }, text("2"), delimit, stdout, ...toFile]],
      ["echo $(echo z)1>f", [...echoZ, text("1"), delimit, stdout, ...toFile]],
      [
        "echo {a,b}1>f",
        [
          ...echo,
          { BraceBegin: {} },
          text("a"),
          { Comma: {} },
          text("b"),
          { BraceEnd: {} },
          text("1"),
          delimit,
          stdout,
          ...toFile,
        ],
      ],
      ["echo *2>f", [...echo, { Asterisk: {} }, text("2"), delimit, stdout, ...toFile]],
      ["echo **2>f", [...echo, { DoubleAsterisk: {} }, text("2"), delimit, stdout, ...toFile]],
      // Bun Shell has no fd numbers above 2. bash reads `12>` as fd 12.
      ["echo 12>f", [...echo, text("12"), delimit, stdout, ...toFile]],
    ])("%s: a digit inside a word stays in the word", (script, expected) => {
      expect(tokens(script)).toEqual(expected);
    });

    test("a digit after an interpolated string stays in the word", () => {
      expect(JSON.parse(lex`echo ${"a b"}2>f`)).toEqual([...echo, text("a b2"), delimit, stdout, ...toFile]);
    });

    test("echo file2>&1: the digit stays in the word", () => {
      // `>&1` with no fd number is not supported, so only the word is compared.
      expect(tokens("echo file2>&1").slice(0, 4)).toEqual([...echo, text("file2"), delimit]);
    });

    test.each([
      ["2>f", [stderr, ...toFile]],
      ["echo z 2>f", [...echo, text("z"), delimit, stderr, ...toFile]],
      ["echo a;2>f", [...echo, text("a"), delimit, { Semicolon: {} }, stderr, ...toFile]],
      ["echo a|2>f", [...echo, text("a"), delimit, { Pipe: {} }, stderr, ...toFile]],
      ['echo "a" 2>f', [...echo, { DoubleQuotedText: "a" }, delimit, stderr, ...toFile]],
      ["echo $X 2>f", [...echo, { Var: "X" }, delimit, stderr, ...toFile]],
      ["echo $(echo z) 2>f", [...echoZ, delimit, stderr, ...toFile]],
      ["echo * 2>f", [...echo, { Asterisk: {} }, delimit, stderr, ...toFile]],
      ["echo ** 2>f", [...echo, { DoubleAsterisk: {} }, delimit, stderr, ...toFile]],
      [
        "echo z 2>&1",
        [...echo, text("z"), delimit, { Redirect: redirect({ stdout: true, duplicate_out: true }) }, eof],
      ],
      [
        "echo z 1>&2",
        [...echo, text("z"), delimit, { Redirect: redirect({ stderr: true, duplicate_out: true }) }, eof],
      ],
    ])("%s: a digit that is a word of its own is an fd number", (script, expected) => {
      expect(tokens(script)).toEqual(expected);
    });

    test.each([
      ["echo ** c", [...echo, { DoubleAsterisk: {} }, delimit, text("c"), delimit, eof]],
      ["echo **|cat", [...echo, { DoubleAsterisk: {} }, delimit, { Pipe: {} }, text("cat"), delimit, eof]],
      [
        "echo ** && echo c",
        [...echo, { DoubleAsterisk: {} }, delimit, { DoubleAmpersand: {} }, ...echo, text("c"), delimit, eof],
      ],
      ["echo **>f", [...echo, { DoubleAsterisk: {} }, delimit, stdout, ...toFile]],
      ["echo **/x", [...echo, { DoubleAsterisk: {} }, text("/x"), delimit, eof]],
      ["echo **", [...echo, { DoubleAsterisk: {} }, eof]],
    ])("%s: whitespace or an operator ends the word that `**` is in", (script, expected) => {
      expect(tokens(script)).toEqual(expected);
    });
  });

  test("obj_ref", () => {
    const expected = [
      {
        Text: "echo",
      },
      {
        Delimit: {},
      },
      {
        Text: "foo",
      },
      {
        Delimit: {},
      },
      {
        Redirect: redirect({ stdout: true }),
      },
      {
        JSObjRef: 0,
      },
      {
        DoubleAmpersand: {},
      },
      {
        Text: "echo",
      },
      {
        Delimit: {},
      },
      {
        Text: "lmao",
      },
      {
        Delimit: {},
      },
      {
        Redirect: redirect({ stdout: true }),
      },
      {
        JSObjRef: 1,
      },
      {
        Eof: {},
      },
    ];
    const buffer = new Uint8Array(1 << 20);
    const buffer2 = new Uint8Array(1 << 20);
    const result = JSON.parse(lex`echo foo > ${buffer} && echo lmao > ${buffer2}`);
    expect(result).toEqual(expected);
  });

  test("cmd_sub_dollar", () => {
    const expected = [
      {
        Text: "echo",
      },
      {
        Delimit: {},
      },
      {
        Text: "foo",
      },
      {
        Delimit: {},
      },
      {
        CmdSubstBegin: {},
      },
      {
        Text: "ls",
      },
      {
        Delimit: {},
      },
      {
        CmdSubstEnd: {},
      },
      {
        Eof: {},
      },
    ];

    const result = lex`echo foo $(ls)`;

    expect(JSON.parse(result)).toEqual(expected);
  });

  test("cmd_sub_dollar_nested", () => {
    const expected = [
      {
        Text: "echo",
      },
      {
        Delimit: {},
      },
      {
        Text: "foo",
      },
      {
        Delimit: {},
      },
      {
        CmdSubstBegin: {},
      },
      {
        Text: "ls",
      },
      {
        Delimit: {},
      },
      {
        CmdSubstBegin: {},
      },
      {
        Text: "ls",
      },
      {
        Delimit: {},
      },
      {
        CmdSubstEnd: {},
      },
      {
        Delimit: {},
      },
      {
        CmdSubstBegin: {},
      },
      {
        Text: "ls",
      },
      {
        Delimit: {},
      },
      {
        CmdSubstEnd: {},
      },
      {
        Delimit: {},
      },
      {
        CmdSubstEnd: {},
      },
      {
        Eof: {},
      },
    ];

    const result = lex`echo foo $(ls $(ls) $(ls))`;
    // console.log(JSON.parse(result));
    expect(JSON.parse(result)).toEqual(expected);
  });

  test("cmd_sub_edgecase", () => {
    const expected = [
      {
        Text: "echo",
      },
      {
        Delimit: {},
      },
      {
        CmdSubstBegin: {},
      },
      {
        Text: "FOO=bar",
      },
      {
        Delimit: {},
      },
      {
        Var: "FOO",
      },
      {
        Delimit: {},
      },
      {
        CmdSubstEnd: {},
      },
      {
        Eof: {},
      },
    ];

    const result = lex`echo $(FOO=bar $FOO)`;

    expect(JSON.parse(result)).toEqual(expected);
  });

  test("cmd_sub_combined_word", () => {
    const expected = [
      {
        Text: "echo",
      },
      {
        Delimit: {},
      },
      {
        CmdSubstBegin: {},
      },
      {
        Text: "FOO=bar",
      },
      {
        Delimit: {},
      },
      {
        Var: "FOO",
      },
      { Delimit: {} },
      {
        CmdSubstEnd: {},
      },
      { Text: "NICE" },
      { Delimit: {} },
      {
        Eof: {},
      },
    ];

    const result = lex`echo $(FOO=bar $FOO)NICE`;

    expect(JSON.parse(result)).toEqual(expected);
  });

  test("cmd_sub_backtick", () => {
    const expected = [
      {
        Text: "echo",
      },
      {
        Delimit: {},
      },
      {
        Text: "foo",
      },
      {
        Delimit: {},
      },
      {
        Text: "`ls`",
      },
      {
        Delimit: {},
      },
      {
        Eof: {},
      },
    ];

    const result = lex`echo foo \`ls\``;

    expect(JSON.parse(result)).toEqual(expected);
  });

  // Where the lexer puts `Delimit` when a word's last part is not plain text
  // (a variable, a closing quote, a brace group), or when the word is split
  // into several tokens. Whitespace and operators delimit such a word; `;`
  // and the end of input do not; the token that splits a word never does.
  test.each([
    [
      "space after a variable",
      "echo $FOO bar",
      [
        { Text: "echo" },
        { Delimit: {} },
        { Var: "FOO" },
        { Delimit: {} },
        { Text: "bar" },
        { Delimit: {} },
        { Eof: {} },
      ],
    ],
    [
      "newline after a variable",
      "echo $FOO\nls",
      [
        { Text: "echo" },
        { Delimit: {} },
        { Var: "FOO" },
        { Delimit: {} },
        { Newline: {} },
        { Text: "ls" },
        { Delimit: {} },
        { Eof: {} },
      ],
    ],
    [
      "escaped newline after a variable",
      "echo $FOO\\\nls",
      [
        { Text: "echo" },
        { Delimit: {} },
        { Var: "FOO" },
        { Delimit: {} },
        { Text: "ls" },
        { Delimit: {} },
        { Eof: {} },
      ],
    ],
    [
      "operator after a variable",
      "$FOO|b",
      [{ Var: "FOO" }, { Delimit: {} }, { Pipe: {} }, { Text: "b" }, { Delimit: {} }, { Eof: {} }],
    ],
    [
      "operator after a space adds no second delimiter",
      "$FOO | b",
      [{ Var: "FOO" }, { Delimit: {} }, { Pipe: {} }, { Text: "b" }, { Delimit: {} }, { Eof: {} }],
    ],
    [
      "space after a closing quote",
      '"a" b',
      [{ DoubleQuotedText: "a" }, { Delimit: {} }, { Text: "b" }, { Delimit: {} }, { Eof: {} }],
    ],
    [
      "space after a brace group",
      "{a,b} c",
      [
        { BraceBegin: {} },
        { Text: "a" },
        { Comma: {} },
        { Text: "b" },
        { BraceEnd: {} },
        { Delimit: {} },
        { Text: "c" },
        { Delimit: {} },
        { Eof: {} },
      ],
    ],
    [
      "semicolon after a variable",
      "$FOO;b",
      [{ Var: "FOO" }, { Semicolon: {} }, { Text: "b" }, { Delimit: {} }, { Eof: {} }],
    ],
    [
      "semicolon after a closing quote",
      '"a";b',
      [{ DoubleQuotedText: "a" }, { Semicolon: {} }, { Text: "b" }, { Delimit: {} }, { Eof: {} }],
    ],
    [
      "semicolon after a brace group",
      "{a,b};c",
      [
        { BraceBegin: {} },
        { Text: "a" },
        { Comma: {} },
        { Text: "b" },
        { BraceEnd: {} },
        { Semicolon: {} },
        { Text: "c" },
        { Delimit: {} },
        { Eof: {} },
      ],
    ],
    ["end of input after a variable", "$FOO", [{ Var: "FOO" }, { Eof: {} }]],
    [
      "variable inside a word",
      "foo$BAR baz",
      [{ Text: "foo" }, { Var: "BAR" }, { Delimit: {} }, { Text: "baz" }, { Delimit: {} }, { Eof: {} }],
    ],
    [
      "glob inside a word",
      "a*b c",
      [{ Text: "a" }, { Asterisk: {} }, { Text: "b" }, { Delimit: {} }, { Text: "c" }, { Delimit: {} }, { Eof: {} }],
    ],
  ])("delimit: %s", (_name, source, expected) => {
    expect(JSON.parse(lex({ raw: [source] }))).toEqual(expected);
  });

  describe("errors", async () => {
    // This is disallowed because the js object references get turned into special vars: $__bun_0, $__bun_1, etc.
    // this will break things inside of a quote.
    test("JS object ref in quotes", async () => {
      const buffer = new Uint8Array(1);
      await TestBuilder.command`FOO=bar ${BUN} -e "console.log(process.env) > ${buffer}"`
        .error("JS object reference not allowed in double quotes")
        .run();
    });

    describe("Unexpected ')'", async () => {
      TestBuilder.command`echo )`.error("Unexpected ')'").runAsTest("lone closing paren");
      TestBuilder.command`echo (echo hi)`.error("Unexpected token: `(`").runAsTest("subshell in invalid position");
      TestBuilder.command`echo "()"`.stdout("()\n").runAsTest("quoted parens");
    });

    test("Unexpected EOF", async () => {
      await TestBuilder.command`echo hi |`.error("Unexpected EOF").run();
      await TestBuilder.command`echo hi &`.error('Background commands "&" are not supported yet.').run();
    });

    test("Unclosed subshell", async () => {
      await TestBuilder.command`echo hi && $(echo uh oh`.error("Unclosed command substitution").run();
      await TestBuilder.command`echo hi && $(echo uh oh)`
        .stdout("hi\n")
        .stderr("bun: command not found: uh\n")
        .exitCode(1)
        .run();

      await TestBuilder.command`echo hi && ${{ raw: "`echo uh oh" }}`.error("Unclosed command substitution").run();
      await TestBuilder.command`echo hi && ${{ raw: "`echo uh oh`" }}`
        .stdout("hi\n")
        .stderr("bun: command not found: uh\n")
        .exitCode(1)
        .run();

      await TestBuilder.command`echo hi && (echo uh oh`.error("Unclosed subshell").run();
    });

    // https://github.com/oven-sh/bun/issues/33235
    TestBuilder.command`(((( |||`
      .error("Unexpected EOF\nUnclosed subshell\nUnclosed subshell\nUnclosed subshell")
      .runAsTest("multiple errors are newline separated");
  });
});
