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

  // A comment ends before the newline that ends its line. That newline still
  // ends the statement, like a newline with no comment in front of it.
  test.each([
    [
      "trailing comment ends the statement",
      "echo one # note\necho two",
      [
        { Text: "echo" },
        { Delimit: {} },
        { Text: "one" },
        { Delimit: {} },
        { Newline: {} },
        { Text: "echo" },
        { Delimit: {} },
        { Text: "two" },
        { Delimit: {} },
        { Eof: {} },
      ],
    ],
    [
      "trailing comment with CRLF",
      "echo one # note\r\necho two",
      [
        { Text: "echo" },
        { Delimit: {} },
        { Text: "one" },
        { Delimit: {} },
        { Newline: {} },
        { Text: "echo" },
        { Delimit: {} },
        { Text: "two" },
        { Delimit: {} },
        { Eof: {} },
      ],
    ],
    [
      "backslash inside a comment does not continue the line",
      "echo one # note \\\necho two",
      [
        { Text: "echo" },
        { Delimit: {} },
        { Text: "one" },
        { Delimit: {} },
        { Newline: {} },
        { Text: "echo" },
        { Delimit: {} },
        { Text: "two" },
        { Delimit: {} },
        { Eof: {} },
      ],
    ],
    [
      "comment on its own line",
      "# note\necho two",
      [{ Newline: {} }, { Text: "echo" }, { Delimit: {} }, { Text: "two" }, { Delimit: {} }, { Eof: {} }],
    ],
    [
      "comment on the last line",
      "echo one # note",
      [{ Text: "echo" }, { Delimit: {} }, { Text: "one" }, { Delimit: {} }, { Eof: {} }],
    ],
    [
      "interpreter line",
      "#!/bin/sh\necho two",
      [{ Newline: {} }, { Text: "echo" }, { Delimit: {} }, { Text: "two" }, { Delimit: {} }, { Eof: {} }],
    ],
  ])("comment: %s", (_name, source, expected) => {
    expect(JSON.parse(lex({ raw: [source] }))).toEqual(expected);
  });

  // The tokens are those of the same script with the comment text removed.
  test.each([
    ["after a word", "echo one # note\necho two", "echo one \necho two"],
    ["after a variable", "echo $X # note\necho two", "echo $X \necho two"],
    ["after a closing quote", 'echo "a" # note\necho b', 'echo "a" \necho b'],
    ["after an assignment", "FOO=bar # note\necho $FOO", "FOO=bar \necho $FOO"],
    [
      "after `fi`, before `else`",
      "if a; then\nif b; then\nc\nfi # note\nelse\nd\nfi",
      "if a; then\nif b; then\nc\nfi \nelse\nd\nfi",
    ],
    ["after `then`", "if a; then # note\nb\nfi", "if a; then \nb\nfi"],
    ["after `else`", "if a; then b\nelse # note\nc\nfi", "if a; then b\nelse \nc\nfi"],
    ["after the `then` of an `elif`", "if a; then b\nelif c; then # note\nd\nfi", "if a; then b\nelif c; then \nd\nfi"],
    ["after `&&`", "echo a && # note\necho b", "echo a && \necho b"],
    ["after `||`", "echo a || # note\necho b", "echo a || \necho b"],
    ["after `|`", "echo a | # note\ncat", "echo a | \ncat"],
    ["after `[[`", "[[ # note\na == a ]]", "[[ \na == a ]]"],
    ["before `]]`", "[[ a == a # note\n]]", "[[ a == a \n]]"],
    ["a comment line in a continued command", "echo a \\\n# note\nb", "echo a \\\n\nb"],
    ["an indented comment line in a continued command", "echo a \\\n  # note\n  b", "echo a \\\n  \n  b"],
    ["in `( )`", "(echo a # note\n)", "(echo a \n)"],
    ["in `$( )`", "echo $(echo a # note\n)", "echo $(echo a \n)"],
    ["in a quoted `$( )`", 'echo "$(echo a # note\n)"', 'echo "$(echo a \n)"'],
    ["`)` is comment text in `$( )`", "echo $(echo a # note)\n)", "echo $(echo a \n)"],
    ["in backquotes, before a newline", "echo `echo a # note\n`", "echo `echo a \n`"],
    ["in backquotes, before the closing backquote", "echo `echo a # note`", "echo `echo a `"],
    ["in backquotes in `$( )`", "echo $(echo `echo a # note`)", "echo $(echo `echo a `)"],
    [
      "in backquotes on three lines",
      "echo `echo 1 # note`\necho `echo 2 # note`\necho `echo 3 # note`",
      "echo `echo 1 `\necho `echo 2 `\necho `echo 3 `",
    ],
    ["CRLF in `( )`", "(echo a # note\r\necho b\n)", "(echo a \necho b\n)"],
    ["CRLF in `$( )`", "echo $(echo a # note\r\necho b)", "echo $(echo a \necho b)"],
    ["CRLF in backquotes", "echo `echo a # note\r\necho b`", "echo `echo a \necho b`"],
    ["backslash-newline ends the comment", "echo one # note \\\necho two", "echo one \necho two"],
    ["backslash-newline ends the comment in `( )`", "(echo a # note \\\necho b\n)", "(echo a \necho b\n)"],
    ["backslash-newline ends the comment in `$( )`", "echo $(echo a # note \\\necho b)", "echo $(echo a \necho b)"],
    [
      "backslash-newline ends the comment in a quoted `$( )`",
      'echo "$(echo a # note \\\necho b)"',
      'echo "$(echo a \necho b)"',
    ],
    ["two backslashes, then a newline", "echo one # note \\\\\necho two", "echo one \necho two"],
    ["backslash-newline in backquotes continues the comment", "echo `echo a # note \\\nmore\n`", "echo `echo a \n`"],
    [
      "backslash-newline in `$( )` in backquotes continues the comment",
      "echo `echo $(echo a # note \\\nmore\n)`",
      "echo `echo $(echo a \n)`",
    ],
    ["escaped backquote in backquotes is comment text", "echo `echo a # note \\` more\n`", "echo `echo a \n`"],
    ["two backslashes, then the closing backquote", "echo `echo a # note \\\\`", "echo `echo a `"],
    // bash ends the outer substitution at this backquote and rejects the script.
    [
      "backquote is comment text in `$( )` in backquotes",
      "echo `echo $(echo a # note ` more\n)`",
      "echo `echo $(echo a \n)`",
    ],
  ])("comment: %s", (_name, commented, plain) => {
    const expected = JSON.parse(lex({ raw: [plain] }));
    expect(JSON.parse(lex({ raw: [commented] }))).toEqual(expected);
    // A character outside ASCII selects the other lexer. `\ö` covers a backslash in front of one.
    expect(JSON.parse(lex({ raw: [commented.replaceAll("note", "nöte \\ö")] }))).toEqual(expected);
  });

  // The closing backquote follows the rule of the `)` of `$( )`.
  test.each([
    ["newline", "echo `echo a\n`", "echo $(echo a\n)", { Newline: {} }],
    ["semicolon", "echo `echo a;`", "echo $(echo a;)", { Semicolon: {} }],
  ])("no delimiter between a %s and the closing backquote", (_name, backquoted, dollarParen, separator) => {
    const expected = [
      { Text: "echo" },
      { Delimit: {} },
      { CmdSubstBegin: {} },
      { Text: "echo" },
      { Delimit: {} },
      { Text: "a" },
      { Delimit: {} },
      separator,
      { CmdSubstEnd: {} },
      { Eof: {} },
    ];
    expect(JSON.parse(lex({ raw: [backquoted] }))).toEqual(expected);
    expect(JSON.parse(lex({ raw: [dollarParen] }))).toEqual(expected);
  });

  test.each([
    ["unquoted", "echo x`echo y`", "echo x$(echo y)"],
    ["in double quotes", 'echo "x`echo y`"', 'echo "x$(echo y)"'],
    ["after a comment that ends at a backquote", "echo `echo a # note`rm`echo b`", "echo $(echo a )rm$(echo b)"],
    ["an empty substitution", "echo x``", "echo x$()"],
  ])("text before a backquote substitution stays in its word: %s", (_name, backquoted, dollarParen) => {
    expect(JSON.parse(lex({ raw: [backquoted] }))).toEqual(JSON.parse(lex({ raw: [dollarParen] })));
  });

  test.each(["echo ``", "echo ` `", "echo $()", "echo $( )"])("no delimiter in the empty substitution %s", source => {
    expect(JSON.parse(lex({ raw: [source] }))).toEqual([
      { Text: "echo" },
      { Delimit: {} },
      { CmdSubstBegin: {} },
      { CmdSubstEnd: {} },
      { Eof: {} },
    ]);
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
