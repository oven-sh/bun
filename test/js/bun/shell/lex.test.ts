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

  // `${` in a JS template literal starts an interpolation, so the sources
  // here go to the lexer as a raw array.
  describe("${...}", () => {
    const tokens = (source: string) => JSON.parse(lex({ raw: [source] }));
    const param = (op: string, target: string | number, word: object[]) => [
      { ParamBegin: op },
      typeof target === "number" ? { VarArgv: target } : { Var: target },
      ...word,
      { ParamEnd: {} },
    ];
    const operators = [":-", "-", ":+", "+", ":=", "=", ":?", "?"];

    test.each([
      ["a whole word", "echo ${PORT}", "echo $PORT"],
      ["in double quotes", 'echo "${X}"', 'echo "$X"'],
      ["in double quotes beside text", 'echo "a ${X} b"', 'echo "a $X b"'],
      ["two in one word", "${A}${B}", "$A$B"],
      ["a positional parameter", "echo ${1}", "echo $1"],
      ["before a brace group", "${X}{a,b}", "$X{a,b}"],
      ["in a brace group", "{${X},b}", "{$X,b}"],
      ["in a script that is not ASCII", "é${X}", "é$X"],
      ["before a character that is not ASCII", "${X}é", "$Xé"],
      ["in $(...)", "echo $(echo ${X})", "echo $(echo $X)"],
      ["in $(...) in a script that is not ASCII", "é $(echo ${X})", "é $(echo $X)"],
      ["in backticks", "echo `echo ${X}`", "echo `echo $X`"],
      ["in a subshell", "(echo ${X})", "(echo $X)"],
      ["before a space", "${FOO} bar", "$FOO bar"],
      ["before a newline", "echo ${FOO}\nls", "echo $FOO\nls"],
      ["before a semicolon", "${FOO};b", "$FOO;b"],
      ["before an operator", "${FOO}|b", "$FOO|b"],
      ["before a #", "${X}#c", "$X#c"],
      ["after a literal $", "$${X}", "$$X"],
      ["in the word of another form", "${X:-${Y}}", "${X:-$Y}"],
      ["in the word of another form, in double quotes", '"${X:-${Y}}"', '"${X:-$Y}"'],
    ])("${NAME} gives the tokens of $NAME: %s", (_name, braced, bare) => {
      expect(tokens(braced)).toEqual(tokens(bare));
    });

    test.each([
      [
        "text after the brace",
        "echo ${FOO}bar",
        [{ Text: "echo" }, { Delimit: {} }, { Var: "FOO" }, { Text: "bar" }, { Delimit: {} }, { Eof: {} }],
      ],
      ["text on both sides", "a${X}b", [{ Text: "a" }, { Var: "X" }, { Text: "b" }, { Delimit: {} }, { Eof: {} }]],
      [
        "text on both sides in a script that is not ASCII",
        "é${X}b",
        [{ Text: "é" }, { Var: "X" }, { Text: "b" }, { Delimit: {} }, { Eof: {} }],
      ],
      ["name characters after the brace", "${X}_1", [{ Var: "X" }, { Text: "_1" }, { Delimit: {} }, { Eof: {} }]],
      ["a digit after a positional parameter", "${1}0", [{ VarArgv: 1 }, { Text: "0" }, { Delimit: {} }, { Eof: {} }]],
      ["an underscore and digits in the name", "${_X_1}", [{ Var: "_X_1" }, { Eof: {} }]],
    ])("the braces end the name: %s", (_name, source, expected) => {
      expect(tokens(source)).toEqual(expected);
    });

    test.each(operators)("${NAME%sword}", op => {
      expect(tokens("${X" + op + "w}")).toEqual([...param(op, "X", [{ Text: "w" }]), { Eof: {} }]);
      expect(tokens('"${X' + op + 'w}"')).toEqual([...param(op, "X", [{ DoubleQuotedText: "w" }]), { Eof: {} }]);
      expect(tokens("${1" + op + "}")).toEqual([...param(op, 1, []), { Eof: {} }]);
    });

    test.each([
      [
        "unquoted whitespace",
        "${X:-  a\tb\nc }",
        [
          { ParamSpace: "  " },
          { Text: "a" },
          { ParamSpace: "\t" },
          { Text: "b" },
          { ParamSpace: "\n" },
          { Text: "c" },
          { ParamSpace: " " },
        ],
      ],
      [
        "quotes",
        "${X:-'a b' \"c d\"}",
        [{ SingleQuotedText: "a b" }, { ParamSpace: " " }, { DoubleQuotedText: "c d" }],
      ],
      ["empty quotes", "${X:-''\"\"}", [{ SingleQuotedText: "" }, { DoubleQuotedText: "" }]],
      [
        "a } in quotes",
        "${X:-a'b}c'\"d}e\"}",
        [{ Text: "a" }, { SingleQuotedText: "b}c" }, { DoubleQuotedText: "d}e" }],
      ],
      ["escapes", "${X:-a\\}b\\ c\\$d}", [{ Text: "a}b c$d" }]],
      ["a line continuation", "${X:-a\\\nb}", [{ Text: "ab" }]],
      ["variables", "${X:-$Y$1 z}", [{ Var: "Y" }, { VarArgv: 1 }, { ParamSpace: " " }, { Text: "z" }]],
      ["a variable in double quotes", '${X:-"$Y"}', [{ Var: "Y" }]],
      ["a $ with no name", "${X:-$ $}", [{ Text: "$" }, { ParamSpace: " " }, { Text: "$" }]],
      ["a glob", "${X:-*.js **}", [{ Asterisk: {} }, { Text: ".js" }, { ParamSpace: " " }, { DoubleAsterisk: {} }]],
      [
        "operators, braces and a # are text",
        "${X:-a;b|c&d<e>f(g)#h{i,j[[k]]}",
        [{ Text: "a;b|c&d<e>f(g)#h{i,j[[k]]" }],
      ],
      ["a tilde is text for the parser", "${X:-~/a}", [{ Text: "~/a" }]],
      [
        "$(...)",
        "${X:-$(echo a) b}",
        [
          { CmdSubstBegin: {} },
          { Text: "echo" },
          { Delimit: {} },
          { Text: "a" },
          { Delimit: {} },
          { CmdSubstEnd: {} },
          { ParamSpace: " " },
          { Text: "b" },
        ],
      ],
      ["backticks", "${X:-`echo`}", [{ CmdSubstBegin: {} }, { Text: "echo" }, { Delimit: {} }, { CmdSubstEnd: {} }]],
      [
        "a nested form",
        "${X:-a${Y:+b ${Z}}c}",
        [{ Text: "a" }, ...param(":+", "Y", [{ Text: "b" }, { ParamSpace: " " }, { Var: "Z" }]), { Text: "c" }],
      ],
      ["a nested form that is not read keeps its }", "${X:-${Y%z}}", [{ Text: "$" }, { Text: "{Y%z}" }]],
      ["an escaped nested form does not", "${X:-\\${Y}", [{ Text: "${Y" }]],
    ])("the word: %s", (_name, source, word) => {
      expect(tokens(source)).toEqual([...param(":-", "X", word), { Eof: {} }]);
    });

    // `$?` and the like are not read yet. What reads them must read them in a word too.
    test.each(["$?", "$$", "$#", "$@", "$!", "$-", "$*", "$=", "$", "$NAME", "$1", "$9x", "${Y}", "${Y:-z}", "$(a)"])(
      "the word: %s gives the tokens that it gives outside of a form",
      dollar => {
        const outside = tokens(dollar);
        while ("Delimit" in outside.at(-1) || "Eof" in outside.at(-1)) outside.pop();
        expect(tokens("${X:-" + dollar + "}")).toEqual([...param(":-", "X", outside), { Eof: {} }]);
      },
    );

    test.each([
      ["text and whitespace", '"${X:-a  b}"', [{ DoubleQuotedText: "a  b" }]],
      ["single quotes are text", '"${X:-\'a}"', [{ DoubleQuotedText: "'a" }]],
      ["inner double quotes keep a }", '"${X:-a"b}c"d}"', [{ DoubleQuotedText: "ab}cd" }]],
      ["a backslash keeps a }", '"${X:-a\\}b}"', [{ DoubleQuotedText: "a}b" }]],
      ["a glob is text", '"${X:-*}"', [{ DoubleQuotedText: "*" }]],
      [
        "$(...)",
        '"${X:-$(echo)}"',
        [{ CmdSubstBegin: {} }, { CmdSubstQuoted: {} }, { Text: "echo" }, { Delimit: {} }, { CmdSubstEnd: {} }],
      ],
    ])("the word in double quotes: %s", (_name, source, word) => {
      expect(tokens(source)).toEqual([...param(":-", "X", word), { Eof: {} }]);
    });

    test.each([
      [
        "inside a word",
        "pre${X:-d}post",
        [{ Text: "pre" }, ...param(":-", "X", [{ Text: "d" }]), { Text: "post" }, { Delimit: {} }, { Eof: {} }],
      ],
      [
        "before a space",
        "${X:-a} b",
        [...param(":-", "X", [{ Text: "a" }]), { Delimit: {} }, { Text: "b" }, { Delimit: {} }, { Eof: {} }],
      ],
      [
        "before a semicolon",
        "${X:-a};b",
        [...param(":-", "X", [{ Text: "a" }]), { Semicolon: {} }, { Text: "b" }, { Delimit: {} }, { Eof: {} }],
      ],
      [
        "before a pipe",
        "${X:-a}|b",
        [
          ...param(":-", "X", [{ Text: "a" }]),
          { Delimit: {} },
          { Pipe: {} },
          { Text: "b" },
          { Delimit: {} },
          { Eof: {} },
        ],
      ],
      [
        "two forms",
        "${X:-a}${Y:-b}",
        [...param(":-", "X", [{ Text: "a" }]), ...param(":-", "Y", [{ Text: "b" }]), { Eof: {} }],
      ],
      [
        "in $(...)",
        "$(echo ${X:-a})",
        [
          { CmdSubstBegin: {} },
          { Text: "echo" },
          { Delimit: {} },
          ...param(":-", "X", [{ Text: "a" }]),
          { Delimit: {} },
          { CmdSubstEnd: {} },
          { Eof: {} },
        ],
      ],
      [
        "in a script that is not ASCII",
        "é${X:-ü ö}é",
        [
          { Text: "é" },
          ...param(":-", "X", [{ Text: "ü" }, { ParamSpace: " " }, { Text: "ö" }]),
          { Text: "é" },
          { Delimit: {} },
          { Eof: {} },
        ],
      ],
    ])("a form beside other tokens: %s", (_name, source, expected) => {
      expect(tokens(source)).toEqual(expected);
    });

    const literal = (...inside: object[]) => [
      { Text: "$" },
      { BraceBegin: {} },
      ...inside,
      { BraceEnd: {} },
      { Eof: {} },
    ];
    test.each([
      ["an escaped $", "\\${X}", literal({ Text: "X" })],
      ["an escaped {", "$\\{X}", [{ Text: "$" }, { Text: "{X" }, { BraceEnd: {} }, { Eof: {} }]],
      ["single quotes", "'${X}'", [{ SingleQuotedText: "${X}" }, { Eof: {} }]],
      ["an escaped $ in double quotes", '"\\${X}"', [{ DoubleQuotedText: "${X}" }, { Eof: {} }]],
      ["an escaped $ before an operator", "\\${X:-d}", literal({ Text: "X:-d" })],
      [
        "an escaped { before an operator",
        "$\\{X:-d}",
        [{ Text: "$" }, { Text: "{X:-d" }, { BraceEnd: {} }, { Eof: {} }],
      ],
      ["an operator in single quotes", "'${X:-d}'", [{ SingleQuotedText: "${X:-d}" }, { Eof: {} }]],
    ])("stays text, as in sh: %s", (_name, source, expected) => {
      expect(tokens(source)).toEqual(expected);
    });

    // sh expands or rejects each of these. Bun's shell does not read them:
    // the `$` is text and the rest is lexed as ordinary shell syntax.
    test.each([
      ["a suffix pattern", "${X%a}", literal({ Text: "X%a" })],
      ["a substitution", "${X/a/b}", literal({ Text: "X/a/b" })],
      ["a substring", "${X:1:2}", literal({ Text: "X:1:2" })],
      ["a : with no operator", "${X:}", literal({ Text: "X:" })],
      ["a length", "${#X}", literal({ Text: "#X" })],
      ["an indirection", "${!X}", literal({ Text: "!X" })],
      ["two digits", "${10}", literal({ Text: "10" })],
      ["two digits before an operator", "${10:-a}", literal({ Text: "10:-a" })],
      ["no name", "${}", literal()],
      ["no name before an operator", "${:-a}", literal({ Text: ":-a" })],
      ["a digit then a letter", "${1a}", literal({ Text: "1a" })],
      ["a name that is not ASCII", "${é}", literal({ Text: "é" })],
      ["spaces around the name", "${ X }", literal({ Delimit: {} }, { Text: "X" }, { Delimit: {} })],
      ["a backslash in the name", "${F\\OO}", literal({ Text: "FOO" })],
      ["a brace group after $", "${a,b}", literal({ Text: "a" }, { Comma: {} }, { Text: "b" })],
      ["$?", "$?", [{ Text: "$" }, { Text: "?" }, { Delimit: {} }, { Eof: {} }]],
      ["$$", "$$", [{ Text: "$" }, { Text: "$" }, { Eof: {} }]],
    ])("not read, tokens unchanged: %s", (_name, source, expected) => {
      expect(tokens(source)).toEqual(expected);
    });

    // A script with a form that does not end is lexed with every `${` as text.
    test.each([
      ["no closing brace", "${X", [{ Text: "$" }, { BraceBegin: {} }, { Text: "X" }, { Delimit: {} }, { Eof: {} }]],
      [
        "no closing brace after a word",
        "${X:-a",
        [{ Text: "$" }, { BraceBegin: {} }, { Text: "X:-a" }, { Delimit: {} }, { Eof: {} }],
      ],
      [
        "no closing brace in double quotes",
        '"${X:-a',
        [{ DoubleQuotedText: "$" }, { DoubleQuotedText: "{X:-a" }, { Delimit: {} }, { Eof: {} }],
      ],
      [
        "the closing brace is in quotes",
        "${X:-'a}",
        [{ Text: "$" }, { BraceBegin: {} }, { Text: "X:-" }, { SingleQuotedText: "a}" }, { Delimit: {} }, { Eof: {} }],
      ],
      [
        "a form that ends, before one that does not",
        "${A:-b} ${X:-a",
        [
          { Text: "$" },
          { BraceBegin: {} },
          { Text: "A:-b" },
          { BraceEnd: {} },
          { Delimit: {} },
          { Text: "$" },
          { BraceBegin: {} },
          { Text: "X:-a" },
          { Delimit: {} },
          { Eof: {} },
        ],
      ],
      [
        "no closing brace in $(...)",
        "$(echo ${X:-a)",
        [
          { CmdSubstBegin: {} },
          { Text: "echo" },
          { Delimit: {} },
          { Text: "$" },
          { BraceBegin: {} },
          { Text: "X:-a" },
          { Delimit: {} },
          { CmdSubstEnd: {} },
          { Eof: {} },
        ],
      ],
      [
        "no closing brace in backticks",
        "`echo ${X:-a`",
        [
          { CmdSubstBegin: {} },
          { Text: "echo" },
          { Delimit: {} },
          { Text: "$" },
          { BraceBegin: {} },
          { Text: "X:-a" },
          { Delimit: {} },
          { CmdSubstEnd: {} },
          { Eof: {} },
        ],
      ],
      [
        "a backtick in the word ends the backticks around the form",
        "`echo ${X:-a`true`echo b}`",
        [
          { CmdSubstBegin: {} },
          { Text: "echo" },
          { Delimit: {} },
          { Text: "$" },
          { BraceBegin: {} },
          { Text: "X:-a" },
          { Delimit: {} },
          { CmdSubstEnd: {} },
          { CmdSubstBegin: {} },
          { Text: "trueecho" },
          { Delimit: {} },
          { Text: "b" },
          { BraceEnd: {} },
          { Delimit: {} },
          { CmdSubstEnd: {} },
          { Eof: {} },
        ],
      ],
      [
        "no closing brace for ${NAME} in $(...)",
        "$(echo ${X)",
        [
          { CmdSubstBegin: {} },
          { Text: "echo" },
          { Delimit: {} },
          { Text: "$" },
          { BraceBegin: {} },
          { Text: "X" },
          { Delimit: {} },
          { CmdSubstEnd: {} },
          { Eof: {} },
        ],
      ],
    ])("a form that does not end is text: %s", (_name, source, expected) => {
      expect(tokens(source)).toEqual(expected);
    });

    test("a script with a form that does not end has the error it had as text", () => {
      expect(() => lex({ raw: ["${X:-$(echo}"] })).toThrow("Unclosed command substitution");
      expect(() => lex({ raw: ["${X:-a} |& b"] })).toThrow("Piping stdout and stderr (`|&`) is not supported yet.");
    });

    // As text, a `${NAME:?}` guard stops nothing. So a script with a guard is not lexed again.
    test.each([
      ["the guard before a form that does not end", 'true "${X:?}"; echo ${Y:-z'],
      ["the guard after a form that does not end", "echo ${Y:-z; echo ${X?need X}"],
      ["the guard that does not end", "echo ${X:?need X"],
      ["the guard in the form that does not end", "echo ${Y:-${X?}"],
      ["a backtick in a word in backticks", "${X:?}; `echo ${Y:-a`"],
    ])("a form that does not end is an error in a script with a ? form: %s", (_name, source) => {
      expect(() => lex({ raw: [source] })).toThrow("Unclosed parameter expansion");
    });

    test("the errors of a script with a ? form", () => {
      expect(() => lex({ raw: ["${X:?}", ""] }, new Uint8Array(1))).not.toThrow();
      expect(() => lex({ raw: ["${X:?} ${Y:-", "}"] }, new Uint8Array(1))).toThrow(
        "JS object reference not allowed in a parameter expansion",
      );
      const repeat = (text: string, count: number) => Buffer.alloc(text.length * count, text).toString();
      expect(() => lex({ raw: [repeat("${A?", 129) + repeat("}", 129)] })).toThrow("SubshellDepthExceeded");
    });

    test("forms nest to the depth of $(...), and deeper forms are text", () => {
      const forms = (source: string) => tokens(source).filter((token: object) => "ParamBegin" in token);
      const repeat = (text: string, count: number) => Buffer.alloc(text.length * count, text).toString();
      const nested = (depth: number) => repeat("${A:-", depth) + "x" + repeat("}", depth);
      expect(forms(nested(128))).toHaveLength(128);
      expect(forms(nested(129))).toHaveLength(128);
      // A form counts as one level of $(...).
      const inSubst = (depth: number) => repeat("$(echo ", depth) + "${A:-x}" + repeat(")", depth);
      expect(forms(inSubst(127))).toHaveLength(1);
      expect(forms(inSubst(128))).toHaveLength(0);
      // The forms after a form that is text are read.
      expect(forms(nested(129) + ' "${X:?}"')).toHaveLength(129);
    });

    // The lexer stopped before the end, so a guard can follow. The script is not lexed again with every `${` as text.
    test("a $(...) past the nesting limit in the word of a form is an error", () => {
      const repeat = (text: string, count: number) => Buffer.alloc(text.length * count, text).toString();
      const tooDeep = repeat("${A:-", 128) + "$(echo x)" + repeat("}", 128);
      expect(() => lex({ raw: [tooDeep] })).toThrow("SubshellDepthExceeded");
      expect(() => lex({ raw: [tooDeep + '; true "${X:?}" && echo RAN'] })).toThrow("SubshellDepthExceeded");
    });

    // An interpolated value is data. It never supplies the name, the operator
    // or the closing brace of a form that the template opens.
    test.each([
      ["the whole name", ["echo ${", "}"], "X", literal({ Text: "X" })],
      ["the end of the name", ["echo ${FOO", "}"], "BAR", literal({ Text: "FOO" }, { Text: "BAR" })],
      ["a digit", ["echo ${", "}"], 1, literal({ Text: "1" })],
      ["the name, after an escaped $", ["echo \\${", "}"], "X", literal({ Text: "X" })],
      ["the operator", ["echo ${FOO", "}"], ":-d", literal({ Text: "FOO" }, { Text: ":-d" })],
      ["the end of the operator", ["echo ${FOO:", "}"], "-d", literal({ Text: "FOO:" }, { Text: "-d" })],
      ["the word", ["echo ${FOO:-", "}"], "d", [...param(":-", "FOO", [{ Text: "d" }]), { Eof: {} }]],
      [
        "a word that looks like a tilde",
        ["echo ${FOO:-", "}"],
        "~",
        [...param(":-", "FOO", [{ DoubleQuotedText: "~" }]), { Eof: {} }],
      ],
      [
        "a word with a closing brace",
        ["echo ${FOO:-", "}"],
        "a}b",
        [...param(":-", "FOO", [{ Text: "a}b" }]), { Eof: {} }],
      ],
      [
        "a word with syntax",
        ["echo ${FOO:-", "}"],
        "$(x) `y` $Z *",
        [...param(":-", "FOO", [{ Text: "$(x) `y` $Z *" }]), { Eof: {} }],
      ],
    ])("an interpolated value is not syntax of a form: %s", (_name, raw, value, word) => {
      expect(JSON.parse(lex({ raw }, value))).toEqual([{ Text: "echo" }, { Delimit: {} }, ...word]);
    });

    // A value with no special character goes into the script as text. A value
    // with one goes in as a reference. After any start of a `$` form, both
    // must give the same tokens apart from text.
    test("a value that is text and a value that is a reference give the same tokens after a $", () => {
      const syntax = (source: string[], value: string) => {
        try {
          return JSON.parse(lex({ raw: source }, value))
            .filter((token: object) => !Object.keys(token)[0].endsWith("Text"))
            .map((token: object) => ("Var" in token || "ParamBegin" in token ? token : Object.keys(token)[0]));
        } catch (error) {
          return String(error);
        }
      };
      // A byte that the lexer learns to read after `${NAME` must be here, and in `ends_in_param_head`.
      const alphabet = ["{", "}", "?", ":", "-", "+", "=", "a", "1", "#", "!", "@", '"', "%", "/", "^"];
      const short = ["", ...alphabet, ...alphabet.flatMap(first => alphabet.map(second => first + second))];
      const tails = ["", "{a", "{1"].flatMap(head => short.map(tail => head + tail));
      const differences = tails.filter(tail => {
        const source = ["echo $" + tail, "}"];
        return JSON.stringify(syntax(source, "bc")) !== JSON.stringify(syntax(source, "b c"));
      });
      expect(differences).toEqual([]);
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

    // https://github.com/oven-sh/bun/issues/33235
    TestBuilder.command`(((( |||`
      .error("Unexpected EOF\nUnclosed subshell\nUnclosed subshell\nUnclosed subshell")
      .runAsTest("multiple errors are newline separated");
  });
});
