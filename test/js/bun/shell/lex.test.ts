import { $ } from "bun";
import { shellInternals } from "bun:internal-for-testing";
import { bunEnv, bunExe } from "harness";
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

  // The text before a command substitution becomes its own token and stays
  // outside the substitution. Each row gives the same tokens in both spellings.
  test.each([
    [
      "two in one word",
      "a`b`c`d`e",
      "a$(b)c$(d)e",
      [
        { Text: "a" },
        { CmdSubstBegin: {} },
        { Text: "b" },
        { Delimit: {} },
        { CmdSubstEnd: {} },
        { Text: "c" },
        { CmdSubstBegin: {} },
        { Text: "d" },
        { Delimit: {} },
        { CmdSubstEnd: {} },
        { Text: "e" },
        { Delimit: {} },
        { Eof: {} },
      ],
    ],
    [
      "text with a space inside double quotes",
      '"a `b` c"',
      '"a $(b) c"',
      [
        { DoubleQuotedText: "a " },
        { CmdSubstBegin: {} },
        { CmdSubstQuoted: {} },
        { Text: "b" },
        { Delimit: {} },
        { CmdSubstEnd: {} },
        { DoubleQuotedText: " c" },
        { Eof: {} },
      ],
    ],
    [
      "inside $(...)",
      "$(a`b`c)",
      "$(a$(b)c)",
      [
        { CmdSubstBegin: {} },
        { Text: "a" },
        { CmdSubstBegin: {} },
        { Text: "b" },
        { Delimit: {} },
        { CmdSubstEnd: {} },
        { Text: "c" },
        { Delimit: {} },
        { CmdSubstEnd: {} },
        { Eof: {} },
      ],
    ],
    [
      "inside a subshell",
      "(a`b`c)",
      "(a$(b)c)",
      [
        { OpenParen: {} },
        { Text: "a" },
        { CmdSubstBegin: {} },
        { Text: "b" },
        { Delimit: {} },
        { CmdSubstEnd: {} },
        { Text: "c" },
        { Delimit: {} },
        { CloseParen: {} },
        { Eof: {} },
      ],
    ],
    [
      "after non-ASCII text",
      "é`b`",
      "é$(b)",
      [{ Text: "é" }, { CmdSubstBegin: {} }, { Text: "b" }, { Delimit: {} }, { CmdSubstEnd: {} }, { Eof: {} }],
    ],
    [
      "in a redirect target",
      "> o`b`",
      "> o$(b)",
      [
        { Redirect: redirect({ stdout: true }) },
        { Text: "o" },
        { CmdSubstBegin: {} },
        { Text: "b" },
        { Delimit: {} },
        { CmdSubstEnd: {} },
        { Eof: {} },
      ],
    ],
    [
      "after a digit",
      "1`b`",
      "1$(b)",
      [{ Text: "1" }, { CmdSubstBegin: {} }, { Text: "b" }, { Delimit: {} }, { CmdSubstEnd: {} }, { Eof: {} }],
    ],
    [
      "after an escaped space",
      "a\\ `b`",
      "a\\ $(b)",
      [{ Text: "a " }, { CmdSubstBegin: {} }, { Text: "b" }, { Delimit: {} }, { CmdSubstEnd: {} }, { Eof: {} }],
    ],
    ["empty body", "a``", "a$()", [{ Text: "a" }, { CmdSubstBegin: {} }, { CmdSubstEnd: {} }, { Eof: {} }]],
  ])("command substitution inside a word: %s", (_name, backtick, dollar, expected) => {
    expect(JSON.parse(lex({ raw: [backtick] }))).toEqual(expected);
    expect(JSON.parse(lex({ raw: [dollar] }))).toEqual(expected);
  });

  // The text before a backtick substitution stays in its word. It is not run
  // inside the substitution.
  describe("backtick substitution inside a word", () => {
    const BACKTICK = { raw: "`" };

    TestBuilder.command`echo pre${BACKTICK}echo m${BACKTICK}post`
      .stdout("prempost\n")
      .runAsTest("text before and after");
    TestBuilder.command`echo pre${BACKTICK}echo m${BACKTICK}`.stdout("prem\n").runAsTest("text before");
    TestBuilder.command`echo "a ${BACKTICK}echo m${BACKTICK} b"`.stdout("a m b\n").runAsTest("inside double quotes");
    TestBuilder.command`echo a${BACKTICK}echo b${BACKTICK}c${BACKTICK}echo d${BACKTICK}e`
      .stdout("abcde\n")
      .runAsTest("two substitutions in one word");
    TestBuilder.command`echo $(echo pre${BACKTICK}echo m${BACKTICK}post)`
      .stdout("prempost\n")
      .runAsTest("inside $(...)");
    TestBuilder.command`(echo pre${BACKTICK}echo m${BACKTICK}post)`.stdout("prempost\n").runAsTest("inside a subshell");
    TestBuilder.command`echo ${"a b"}${BACKTICK}echo m${BACKTICK}`
      .stdout("a bm\n")
      .runAsTest("after an interpolated value");
    TestBuilder.command`echo a\ ${BACKTICK}echo m${BACKTICK}`.stdout("a m\n").runAsTest("after an escaped space");
    TestBuilder.command`echo 1${BACKTICK}echo 2${BACKTICK}`.stdout("12\n").runAsTest("after a digit");
    TestBuilder.command`echo ${{ raw: "é" }}${BACKTICK}echo m${BACKTICK}`
      .stdout("ém\n")
      .runAsTest("after non-ASCII text");
    TestBuilder.command`echo hi > out${BACKTICK}echo 1${BACKTICK}.txt`
      .ensureTempDir()
      .fileEquals("out1.txt", "hi\n")
      .runAsTest("in a redirect target");
    TestBuilder.command`FOO=${BACKTICK}echo hi${BACKTICK}; echo "[$FOO]"`
      .stdout("[hi]\n")
      .runAsTest("assignment value");
    TestBuilder.command`FOO=${BACKTICK}echo hi${BACKTICK} && echo "[$FOO]"`
      .stdout("[hi]\n")
      .runAsTest("assignment that heads an && chain");
    TestBuilder.command`FOO=x${BACKTICK}echo hi${BACKTICK}y; echo "[$FOO]"`
      .stdout("[xhiy]\n")
      .runAsTest("assignment value with text around the substitution");
    TestBuilder.command`export FOO=${BACKTICK}echo hi${BACKTICK}; echo "[$FOO]"`
      .stdout("[hi]\n")
      .runAsTest("export operand");
    TestBuilder.command`FOO=${BACKTICK}echo hi${BACKTICK} ${bunExe()} -e ${"console.log(process.env.FOO)"}`
      .env(bunEnv)
      .stdout("hi\n")
      .runAsTest("assignment before a command");
    TestBuilder.command`echo ${BACKTICK}echo m${BACKTICK}post`.stdout("mpost\n").runAsTest("at the start of a word");
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
      "backtick substitution inside a word",
      "a`b`c d",
      [
        { Text: "a" },
        { CmdSubstBegin: {} },
        { Text: "b" },
        { Delimit: {} },
        { CmdSubstEnd: {} },
        { Text: "c" },
        { Delimit: {} },
        { Text: "d" },
        { Delimit: {} },
        { Eof: {} },
      ],
    ],
    [
      "backtick substitution inside double quotes",
      '"a`b`c"',
      [
        { DoubleQuotedText: "a" },
        { CmdSubstBegin: {} },
        { CmdSubstQuoted: {} },
        { Text: "b" },
        { Delimit: {} },
        { CmdSubstEnd: {} },
        { DoubleQuotedText: "c" },
        { Eof: {} },
      ],
    ],
    [
      "backtick substitution as an assignment value",
      "FOO=`echo hi`",
      [
        { Text: "FOO=" },
        { CmdSubstBegin: {} },
        { Text: "echo" },
        { Delimit: {} },
        { Text: "hi" },
        { Delimit: {} },
        { CmdSubstEnd: {} },
        { Eof: {} },
      ],
    ],
    [
      "subshell after text",
      "a(b)",
      [
        { Text: "a" },
        { Delimit: {} },
        { OpenParen: {} },
        { Text: "b" },
        { Delimit: {} },
        { CloseParen: {} },
        { Eof: {} },
      ],
    ],
    [
      "subshell after a closing quote",
      '"a"(b)',
      [{ DoubleQuotedText: "a" }, { OpenParen: {} }, { Text: "b" }, { Delimit: {} }, { CloseParen: {} }, { Eof: {} }],
    ],
    [
      "subshell after a variable",
      "$X(b)",
      [{ Var: "X" }, { OpenParen: {} }, { Text: "b" }, { Delimit: {} }, { CloseParen: {} }, { Eof: {} }],
    ],
    [
      "glob inside a word",
      "a*b c",
      [{ Text: "a" }, { Asterisk: {} }, { Text: "b" }, { Delimit: {} }, { Text: "c" }, { Delimit: {} }, { Eof: {} }],
    ],
  ])("delimit: %s", (_name, source, expected) => {
    expect(JSON.parse(lex({ raw: [source] }))).toEqual(expected);
  });

  // The `)` of `$(` and the closing backtick put a Delimit before CmdSubstEnd only after a
  // token that is part of a word. The parser takes a Delimit after any other token for the
  // start of one more command: `expected a command or assignment but got: "CmdSubstEnd"`.
  describe("end of cmd subst", () => {
    const buffer = new Uint8Array(8);
    // `@` in the source is an interpolated Buffer.
    const tokens = (source: string) => {
      const raw = source.split("@");
      return JSON.parse(lex({ raw }, ...raw.slice(1).map(() => buffer)));
    };
    const echo = [{ Text: "echo" }, { Delimit: {} }];
    const echoHi = [...echo, { Text: "hi" }, { Delimit: {} }];
    const toBuffer = [...echoHi, { Redirect: redirect({ stdout: true }) }, { JSObjRef: 0 }];

    // [what the body ends in, the body, the tokens of the body]
    const bodies: [string, string, object[]][] = [
      ["a JS object", "echo hi > @", toBuffer],
      ["a JS object and a blank", "echo hi > @ ", toBuffer],
      ["a subshell", " (echo hi)", [{ OpenParen: {} }, ...echoHi, { CloseParen: {} }]],
      [
        "`]]` and a blank",
        "[[ -n x ]] ",
        [
          { DoubleBracketOpen: {} },
          { Text: "-n" },
          { Delimit: {} },
          { Text: "x" },
          { Delimit: {} },
          { DoubleBracketClose: {} },
        ],
      ],
      ["`[[`", "[[ ", [{ DoubleBracketOpen: {} }]],
      ["nothing", "", []],
      ["a blank", " ", []],
      ["`;`", "echo hi;", [...echoHi, { Semicolon: {} }]],
      ["a newline", "echo hi\n", [...echoHi, { Newline: {} }]],
      ["`2>&1`", "echo hi 2>&1", [...echoHi, { Redirect: redirect({ stdout: true, duplicate_out: true }) }]],
      ["`|`", "echo hi |", [...echoHi, { Pipe: {} }]],
      ["`||`", "echo hi ||", [...echoHi, { DoublePipe: {} }]],
      ["`&&`", "echo hi &&", [...echoHi, { DoubleAmpersand: {} }]],
      ["`&`", "echo hi &", [...echoHi, { Ampersand: {} }]],
      // A token that is part of a word keeps its Delimit.
      ["a variable", "echo $FOO", [...echo, { Var: "FOO" }, { Delimit: {} }]],
      ["a closing quote", 'echo "hi"', [...echo, { DoubleQuotedText: "hi" }, { Delimit: {} }]],
      ["`*`", "echo *", [...echo, { Asterisk: {} }, { Delimit: {} }]],
      [
        "a nested substitution",
        "echo $(ls)",
        [...echo, { CmdSubstBegin: {} }, { Text: "ls" }, { Delimit: {} }, { CmdSubstEnd: {} }, { Delimit: {} }],
      ],
    ];

    test.each(
      bodies.flatMap(([end, body, expected]) => [
        ["$(...) ends in " + end, "$(" + body + ")", expected] as const,
        ["`...` ends in " + end, "`" + body + "`", expected] as const,
      ]),
    )("%s", (_name, subst, expected) => {
      // A script that is not ASCII goes through the other lexer.
      for (const word of ["echo", "écho"]) {
        expect(tokens(`${word} ${subst}`)).toEqual([
          { Text: word },
          { Delimit: {} },
          { CmdSubstBegin: {} },
          ...expected,
          { CmdSubstEnd: {} },
          { Eof: {} },
        ]);
      }
    });

    test.each(['echo "$()"', 'echo "``"'])("empty body in double quotes: %s", source => {
      expect(tokens(source)).toEqual([
        ...echo,
        { CmdSubstBegin: {} },
        { CmdSubstQuoted: {} },
        { CmdSubstEnd: {} },
        { Eof: {} },
      ]);
    });

    // Text directly before the opening backtick stays outside the body.
    test.each([
      [
        "X=`echo hi;`",
        [{ Text: "X=" }, { CmdSubstBegin: {} }, ...echoHi, { Semicolon: {} }, { CmdSubstEnd: {} }, { Eof: {} }],
      ],
      [
        "X=`cat < @`",
        [
          { Text: "X=" },
          { CmdSubstBegin: {} },
          { Text: "cat" },
          { Delimit: {} },
          { Redirect: redirect({ stdin: true }) },
          { JSObjRef: 0 },
          { CmdSubstEnd: {} },
          { Eof: {} },
        ],
      ],
      [
        "echo pre`(echo hi)`post",
        [
          ...echo,
          { Text: "pre" },
          { CmdSubstBegin: {} },
          { OpenParen: {} },
          ...echoHi,
          { CloseParen: {} },
          { CmdSubstEnd: {} },
          { Text: "post" },
          { Delimit: {} },
          { Eof: {} },
        ],
      ],
      [
        'echo "a `echo hi\n` b"',
        [
          ...echo,
          { DoubleQuotedText: "a " },
          { CmdSubstBegin: {} },
          { CmdSubstQuoted: {} },
          ...echoHi,
          { Newline: {} },
          { CmdSubstEnd: {} },
          { DoubleQuotedText: " b" },
          { Eof: {} },
        ],
      ],
    ])("text before the backtick: %s", (source, expected) => {
      expect(tokens(source)).toEqual(expected);
    });
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

    // bash reads `$((...))` as arithmetic, never as a subshell inside a command substitution.
    test.each([
      "echo $((1+2))",
      "X=$((X+1))",
      "echo $(((1+2)*3))",
      'echo "$((1+2))"',
      "echo $(echo $((1+2)))",
      "echo `echo $((1+2))`",
      "écho $((1+2))",
    ])("arithmetic expansion: %s", source => {
      expect(() => lex({ raw: [source] })).toThrow(
        new Error(
          "Arithmetic expansion `$((...))` is not supported yet. Compute the value in JavaScript: `${a + b}` in a `$` template, or `$(bun -e 'console.log(1 + 2)')` in a script. For a subshell inside a command substitution, write `$( (...) )`.",
        ),
      );
    });

    // `((` that does not follow `$`, or that has an escaped paren, is not `$((...))`.
    describe("not arithmetic expansion", () => {
      const subshell = [
        { OpenParen: {} },
        { Text: "echo" },
        { Delimit: {} },
        { Text: "a" },
        { Delimit: {} },
        { CloseParen: {} },
      ];
      const twoSubshells = [{ OpenParen: {} }, ...subshell, { CloseParen: {} }];
      const echoOf = (...body: object[]) => [
        { Text: "echo" },
        { Delimit: {} },
        { CmdSubstBegin: {} },
        ...body,
        { CmdSubstEnd: {} },
        { Eof: {} },
      ];

      test.each([
        ["((echo a))", [...twoSubshells, { Eof: {} }]],
        ["echo `((echo a))`", echoOf(...twoSubshells)],
        ["echo $( ((echo a)) )", echoOf(...twoSubshells)],
        ["echo $(\\((echo a))", echoOf({ Text: "(" }, { Delimit: {} }, ...subshell)],
        ["echo $((echo a)\\))", echoOf(...subshell, { Text: ")" }, { Delimit: {} })],
      ])("%s", (source, expected) => {
        expect(JSON.parse(lex({ raw: [source] }))).toEqual(expected);
      });
    });

    // https://github.com/oven-sh/bun/issues/33235
    TestBuilder.command`(((( |||`
      .error("Unexpected EOF\nUnclosed subshell\nUnclosed subshell\nUnclosed subshell")
      .runAsTest("multiple errors are newline separated");
  });
});
