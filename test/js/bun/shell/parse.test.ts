import { shellInternals } from "bun:internal-for-testing";
import { bunEnv, bunExe } from "harness";
import { createTestBuilder, redirect } from "./util";
const { parse } = shellInternals;
const TestBuilder = createTestBuilder(import.meta.path);

describe("parse shell", () => {
  test("basic", () => {
    const expected = {
      stmts: [
        {
          exprs: [
            {
              cmd: {
                assigns: [],
                name_and_args: [
                  {
                    simple: {
                      Text: "echo",
                    },
                  },
                  {
                    simple: {
                      Text: "foo",
                    },
                  },
                ],
                redirect: redirect({}),
                redirect_file: null,
              },
            },
          ],
        },
      ],
    };

    const result = parse`echo foo`;
    expect(JSON.parse(result)).toEqual(expected);
  });

  test("basic redirect", () => {
    const expected = {
      stmts: [
        {
          exprs: [
            {
              cmd: {
                assigns: [],
                name_and_args: [{ simple: { Text: "echo" } }, { simple: { Text: "foo" } }],
                redirect: redirect({ stdout: true }),
                redirect_file: { atom: { simple: { Text: "lmao.txt" } } },
              },
            },
          ],
        },
      ],
    };

    const result = JSON.parse(parse`echo foo > lmao.txt`);
    expect(result).toEqual(expected);
  });

  test("single atom", () => {
    expect(JSON.parse(parse`ls`)).toEqual({
      stmts: [
        {
          exprs: [
            {
              cmd: {
                assigns: [],
                name_and_args: [{ simple: { Text: "ls" } }],
                redirect: redirect({}),
                redirect_file: null,
              },
            },
          ],
        },
      ],
    });

    expect(JSON.parse(parse`echo ~`)).toEqual({
      stmts: [
        {
          exprs: [
            {
              cmd: {
                assigns: [],
                name_and_args: [{ simple: { Text: "echo" } }, { simple: { tilde: {} } }],
                redirect: redirect({}),
                redirect_file: null,
              },
            },
          ],
        },
      ],
    });
  });

  test("compound atom", () => {
    const expected = {
      stmts: [
        {
          exprs: [
            {
              cmd: {
                assigns: [],
                name_and_args: [
                  {
                    compound: {
                      atoms: [{ Text: "FOO " }, { Var: "NICE" }, { Text: "!" }],
                      brace_expansion_hint: false,
                      glob_hint: false,
                    },
                  },
                ],
                redirect: redirect({}),
                redirect_file: null,
              },
            },
          ],
        },
      ],
    };

    const result = JSON.parse(parse`"FOO $NICE!"`);
    console.log("Result", JSON.stringify(result));
    expect(result).toEqual(expected);
  });

  test("pipelines", () => {
    const expected = {
      stmts: [
        {
          exprs: [
            {
              pipeline: {
                items: [
                  {
                    cmd: {
                      assigns: [],
                      name_and_args: [{ simple: { Text: "echo" } }],
                      redirect: redirect({ stdout: true }),
                      redirect_file: { atom: { simple: { Text: "foo.txt" } } },
                    },
                  },
                  {
                    cmd: {
                      assigns: [],
                      name_and_args: [{ simple: { Text: "echo" } }, { simple: { Text: "hi" } }],
                      redirect: redirect({}),
                      redirect_file: null,
                    },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const result = JSON.parse(parse`echo > foo.txt | echo hi`);
    // console.log(result);
    expect(result).toEqual(expected);
  });

  test("binary expressions", () => {
    const expected = {
      stmts: [
        {
          exprs: [
            {
              binary: {
                op: "Or",
                left: {
                  binary: {
                    op: "And",
                    left: {
                      cmd: {
                        assigns: [],
                        name_and_args: [{ simple: { Text: "echo" } }, { simple: { Text: "foo" } }],
                        redirect: redirect(),
                        redirect_file: null,
                      },
                    },
                    right: {
                      cmd: {
                        assigns: [],
                        name_and_args: [{ simple: { Text: "echo" } }, { simple: { Text: "bar" } }],
                        redirect: redirect(),
                        redirect_file: null,
                      },
                    },
                  },
                },
                right: {
                  cmd: {
                    assigns: [],
                    name_and_args: [{ simple: { Text: "echo" } }, { simple: { Text: "lmao" } }],
                    redirect: redirect(),
                    redirect_file: null,
                  },
                },
              },
            },
          ],
        },
      ],
    };
    const result = JSON.parse(parse`echo foo && echo bar || echo lmao`);
    // console.log(result);
    expect(result).toEqual(expected);
  });

  test("precedence", () => {
    const expected = {
      stmts: [
        {
          exprs: [
            {
              binary: {
                op: "And",
                left: {
                  binary: {
                    op: "And",
                    left: {
                      assign: [{ label: "FOO", value: { simple: { Text: "bar" } } }],
                    },
                    right: {
                      cmd: {
                        assigns: [],
                        name_and_args: [{ simple: { Text: "echo" } }, { simple: { Text: "foo" } }],
                        redirect: redirect(),
                        redirect_file: null,
                      },
                    },
                  },
                },
                right: {
                  pipeline: {
                    items: [
                      {
                        cmd: {
                          assigns: [],
                          name_and_args: [{ simple: { Text: "echo" } }, { simple: { Text: "bar" } }],
                          redirect: redirect(),
                          redirect_file: null,
                        },
                      },
                      {
                        cmd: {
                          assigns: [],
                          name_and_args: [{ simple: { Text: "echo" } }, { simple: { Text: "lmao" } }],
                          redirect: redirect(),
                          redirect_file: null,
                        },
                      },
                      {
                        cmd: {
                          assigns: [],
                          name_and_args: [{ simple: { Text: "cat" } }],
                          redirect: redirect({ stdout: true }),
                          redirect_file: {
                            atom: { simple: { Text: "foo.txt" } },
                          },
                        },
                      },
                    ],
                  },
                },
              },
            },
          ],
        },
      ],
    };

    const result = parse`FOO=bar && echo foo && echo bar | echo lmao | cat > foo.txt`;
    // console.log(result);
    expect(JSON.parse(result)).toEqual(expected);
  });

  test("assigns", () => {
    const expected = {
      stmts: [
        {
          exprs: [
            {
              cmd: {
                assigns: [
                  { label: "FOO", value: { simple: { Text: "bar" } } },
                  { label: "BAR", value: { simple: { Text: "baz" } } },
                ],
                name_and_args: [{ simple: { Text: "export" } }, { simple: { Text: "LMAO=nice" } }],
                redirect: {
                  stdin: false,
                  stdout: false,
                  stderr: false,
                  append: false,
                  duplicate_out: false,
                  __unused: 0,
                },
                redirect_file: null,
              },
            },
          ],
        },
      ],
    };

    const result = JSON.parse(parse`FOO=bar BAR=baz export LMAO=nice`);
    console.log("Result", JSON.stringify(result));
    expect(result).toEqual(expected);
  });

  test("redirect js obj", () => {
    const expected = {
      stmts: [
        {
          exprs: [
            {
              binary: {
                op: "And",
                left: {
                  cmd: {
                    assigns: [],
                    name_and_args: [{ simple: { Text: "echo" } }, { simple: { Text: "foo" } }],
                    redirect: redirect({ stdout: true }),
                    redirect_file: { jsbuf: { idx: 0 } },
                  },
                },
                right: {
                  cmd: {
                    assigns: [],
                    name_and_args: [{ simple: { Text: "echo" } }, { simple: { Text: "foo" } }],
                    redirect: redirect({ stdout: true }),
                    redirect_file: { jsbuf: { idx: 1 } },
                  },
                },
              },
            },
          ],
        },
      ],
    };

    const buffer = new Uint8Array(1 << 20);
    const buffer2 = new Uint8Array(1 << 20);
    const result = JSON.parse(parse`echo foo > ${buffer} && echo foo > ${buffer2}`);

    // console.log("Result", JSON.stringify(result));
    expect(result).toEqual(expected);
  });

  test("cmd subst", () => {
    const expected = {
      stmts: [
        {
          exprs: [
            {
              cmd: {
                assigns: [],
                name_and_args: [
                  { simple: { Text: "echo" } },
                  {
                    simple: {
                      cmd_subst: {
                        script: {
                          stmts: [
                            {
                              exprs: [
                                {
                                  cmd: {
                                    assigns: [],
                                    name_and_args: [{ simple: { Text: "echo" } }, { simple: { Text: "1" } }],
                                    redirect: {
                                      stdin: false,
                                      stdout: false,
                                      stderr: false,
                                      append: false,
                                      duplicate_out: false,
                                      __unused: 0,
                                    },
                                    redirect_file: null,
                                  },
                                },
                              ],
                            },
                            {
                              exprs: [
                                {
                                  cmd: {
                                    assigns: [],
                                    name_and_args: [{ simple: { Text: "echo" } }, { simple: { Text: "2" } }],
                                    redirect: {
                                      stdin: false,
                                      stdout: false,
                                      stderr: false,
                                      append: false,
                                      duplicate_out: false,
                                      __unused: 0,
                                    },
                                    redirect_file: null,
                                  },
                                },
                              ],
                            },
                          ],
                        },
                        quoted: true,
                      },
                    },
                  },
                ],
                redirect: {
                  stdin: false,
                  stdout: false,
                  stderr: false,
                  append: false,
                  duplicate_out: false,
                  __unused: 0,
                },
                redirect_file: null,
              },
            },
          ],
        },
      ],
    };

    const result = JSON.parse(parse`echo "$(echo 1; echo 2)"`);
    expect(result).toEqual(expected);
  });

  test("cmd subst edgecase", () => {
    const expected = {
      stmts: [
        {
          exprs: [
            {
              binary: {
                op: "And",
                left: {
                  cmd: {
                    assigns: [],
                    name_and_args: [
                      { simple: { Text: "echo" } },
                      {
                        simple: {
                          cmd_subst: {
                            script: {
                              stmts: [
                                {
                                  exprs: [
                                    {
                                      cmd: {
                                        assigns: [],
                                        name_and_args: [{ simple: { Text: "ls" } }, { simple: { Text: "foo" } }],
                                        redirect: {
                                          stdin: false,
                                          stdout: false,
                                          stderr: false,
                                          append: false,
                                          duplicate_out: false,
                                          __unused: 0,
                                        },
                                        redirect_file: null,
                                      },
                                    },
                                  ],
                                },
                              ],
                            },
                            quoted: false,
                          },
                        },
                      },
                    ],
                    redirect: {
                      stdin: false,
                      stdout: false,
                      stderr: false,
                      append: false,
                      duplicate_out: false,
                      __unused: 0,
                    },
                    redirect_file: null,
                  },
                },
                right: {
                  cmd: {
                    assigns: [],
                    name_and_args: [{ simple: { Text: "echo" } }, { simple: { Text: "nice" } }],
                    redirect: {
                      stdin: false,
                      stdout: false,
                      stderr: false,
                      append: false,
                      duplicate_out: false,
                      __unused: 0,
                    },
                    redirect_file: null,
                  },
                },
              },
            },
          ],
        },
      ],
    };
    const result = JSON.parse(parse`echo $(ls foo) && echo nice`);
    expect(result).toEqual(expected);
  });

  // `${` in a JS template literal starts an interpolation, so the sources
  // here go to the parser as a raw array.
  describe("${...}", () => {
    const cmd = (source: string) => JSON.parse(parse({ raw: [source] })).stmts[0].exprs[0].cmd;
    const args = (source: string) => cmd("echo " + source).name_and_args.slice(1);
    const compound = (atoms: object[], glob_hint = false) => ({
      compound: { atoms, brace_expansion_hint: false, glob_hint },
    });
    const param = (name: string, op: string, word: object[]) => ({ param: { name, op, word } });

    test("${NAME} is the atom of $NAME", () => {
      expect(args("${X} ${1} a${X}b")).toEqual([
        { simple: { Var: "X" } },
        { simple: { VarArgv: 1 } },
        compound([{ Text: "a" }, { Var: "X" }, { Text: "b" }]),
      ]);
    });

    test.each([":-", "-", ":+", "+", ":=", "=", ":?", "?"])("${NAME%sword}", op => {
      expect(args("${X" + op + "a}")).toEqual([{ simple: param("X", op, [{ Text: "a" }]) }]);
    });

    test("the parameter, the quotes and the parts of the word", () => {
      expect(args('"${1:?no $Y}" a${X:-}b ${X:-\'\'"q"$(echo) c}')).toEqual([
        { simple: { param: { argv: 1, op: ":?", word: [{ Text: "no " }, { Var: "Y" }] } } },
        compound([{ Text: "a" }, param("X", ":-", []), { Text: "b" }]),
        {
          simple: param("X", ":-", [
            { quoted_empty: {} },
            { Text: "q" },
            { cmd_subst: { script: { stmts: [{ exprs: [{ cmd: cmd("echo") }] }] }, quoted: false } },
            { param_space: " " },
            { Text: "c" },
          ]),
        },
      ]);
    });

    test("a * in the word gives the atom the glob hint", () => {
      expect(args("${X:-*} x${Y:+${X:-a **}} ${X:-a b}")).toEqual([
        compound([param("X", ":-", [{ asterisk: {} }])], true),
        compound(
          [
            { Text: "x" },
            param("Y", ":+", [param("X", ":-", [{ Text: "a" }, { param_space: " " }, { double_asterisk: {} }])]),
          ],
          true,
        ),
        { simple: param("X", ":-", [{ Text: "a" }, { param_space: " " }, { Text: "b" }]) },
      ]);
      expect(args('"${X:-a b}" "${X:-*}"')).toEqual([
        { simple: param("X", ":-", [{ Text: "a b" }]) },
        { simple: param("X", ":-", [{ Text: "*" }]) },
      ]);
    });

    // As in sh: the `~` is `$HOME` when it is the whole word or a `/` follows it.
    test("a tilde starts the word", () => {
      expect(args("${X:-~} ${X:-~/a~} ${X:=~}")).toEqual([
        { simple: param("X", ":-", [{ tilde: {} }]) },
        { simple: param("X", ":-", [{ tilde: {} }, { Text: "/a~" }]) },
        { simple: param("X", ":=", [{ tilde: {} }]) },
      ]);
      expect(args('${X:-a~} ${X:-~a} ${X:-~$Y} ${X:-~ a} ${X:-~""} ${X:-~"/a"} "${X:-~}"')).toEqual([
        { simple: param("X", ":-", [{ Text: "a~" }]) },
        { simple: param("X", ":-", [{ Text: "~a" }]) },
        { simple: param("X", ":-", [{ Text: "~" }, { Var: "Y" }]) },
        { simple: param("X", ":-", [{ Text: "~" }, { param_space: " " }, { Text: "a" }]) },
        { simple: param("X", ":-", [{ Text: "~" }, { quoted_empty: {} }]) },
        { simple: param("X", ":-", [{ Text: "~" }, { Text: "/a" }]) },
        { simple: param("X", ":-", [{ Text: "~" }]) },
      ]);
    });

    test("in an assignment value and a redirect target", () => {
      const parsed = cmd("A=${X:-a} B=b${X:+c} echo > ${Y:-f}");
      expect(parsed.assigns).toEqual([
        { label: "A", value: { simple: param("X", ":-", [{ Text: "a" }]) } },
        { label: "B", value: compound([{ Text: "b" }, param("X", ":+", [{ Text: "c" }])]) },
      ]);
      expect(parsed.redirect_file).toEqual({ atom: { simple: param("Y", ":-", [{ Text: "f" }]) } });
    });

    // A form whose word does not parse makes the parser read the script with every `${` as text.
    test("a script that does not parse with a form is parsed as text", () => {
      const source = "A=${X:-a; echo b} > f";
      expect(JSON.parse(parse({ raw: [source] })).stmts[0].exprs[0].assign).toEqual([
        { label: "A", value: compound([{ Text: "$" }, { brace_begin: {} }, { Text: "X:-a" }]) },
      ]);
      // With a `?` form in the script, the error of the pass that read the forms is the result.
      expect(() => parse({ raw: ["echo ${G?}; " + source] })).toThrow(
        'expected a command or assignment but got: "Redirect"',
      );
    });
  });

  describe("if_clause", () => {
    test("basic", () => {
      const expected = {
        "stmts": [
          {
            "exprs": [
              {
                "if": {
                  "cond": [
                    {
                      "exprs": [
                        {
                          "cmd": {
                            "assigns": [],
                            "name_and_args": [{ "simple": { "Text": "echo" } }, { "simple": { "Text": "hi" } }],
                            "redirect": {
                              "stdin": false,
                              "stdout": false,
                              "stderr": false,
                              "append": false,
                              "duplicate_out": false,
                              "__unused": 0,
                            },
                            "redirect_file": null,
                          },
                        },
                      ],
                    },
                  ],
                  "then": [
                    {
                      "exprs": [
                        {
                          "cmd": {
                            "assigns": [],
                            "name_and_args": [{ "simple": { "Text": "echo" } }, { "simple": { "Text": "lmao" } }],
                            "redirect": {
                              "stdin": false,
                              "stdout": false,
                              "stderr": false,
                              "append": false,
                              "duplicate_out": false,
                              "__unused": 0,
                            },
                            "redirect_file": null,
                          },
                        },
                      ],
                    },
                  ],
                  "else_parts": [
                    [
                      {
                        "exprs": [
                          {
                            "cmd": {
                              "assigns": [],
                              "name_and_args": [{ "simple": { "Text": "echo" } }, { "simple": { "Text": "lol" } }],
                              "redirect": {
                                "stdin": false,
                                "stdout": false,
                                "stderr": false,
                                "append": false,
                                "duplicate_out": false,
                                "__unused": 0,
                              },
                              "redirect_file": null,
                            },
                          },
                        ],
                      },
                    ],
                  ],
                },
              },
            ],
          },
        ],
      };

      let result = JSON.parse(parse`if echo hi; then echo lmao; else echo lol; fi`);
      expect(result).toEqual(expected);
      result = JSON.parse(parse`if echo hi
      then echo lmao
      else echo lol
      fi`);
      expect(result).toEqual(expected);
    });

    test("elif", () => {
      const expected = {
        "stmts": [
          {
            "exprs": [
              {
                "if": {
                  "cond": [
                    {
                      "exprs": [
                        {
                          "cmd": {
                            "assigns": [],
                            "name_and_args": [{ "simple": { "Text": "a" } }],
                            "redirect": {
                              "stdin": false,
                              "stdout": false,
                              "stderr": false,
                              "append": false,
                              "duplicate_out": false,
                              "__unused": 0,
                            },
                            "redirect_file": null,
                          },
                        },
                      ],
                    },
                  ],
                  "then": [
                    {
                      "exprs": [
                        {
                          "cmd": {
                            "assigns": [],
                            "name_and_args": [{ "simple": { "Text": "b" } }],
                            "redirect": {
                              "stdin": false,
                              "stdout": false,
                              "stderr": false,
                              "append": false,
                              "duplicate_out": false,
                              "__unused": 0,
                            },
                            "redirect_file": null,
                          },
                        },
                      ],
                    },
                  ],
                  "else_parts": [
                    [
                      {
                        "exprs": [
                          {
                            "cmd": {
                              "assigns": [],
                              "name_and_args": [{ "simple": { "Text": "c" } }],
                              "redirect": {
                                "stdin": false,
                                "stdout": false,
                                "stderr": false,
                                "append": false,
                                "duplicate_out": false,
                                "__unused": 0,
                              },
                              "redirect_file": null,
                            },
                          },
                        ],
                      },
                    ],
                    [
                      {
                        "exprs": [
                          {
                            "cmd": {
                              "assigns": [],
                              "name_and_args": [{ "simple": { "Text": "d" } }],
                              "redirect": {
                                "stdin": false,
                                "stdout": false,
                                "stderr": false,
                                "append": false,
                                "duplicate_out": false,
                                "__unused": 0,
                              },
                              "redirect_file": null,
                            },
                          },
                        ],
                      },
                    ],
                    [
                      {
                        "exprs": [
                          {
                            "cmd": {
                              "assigns": [],
                              "name_and_args": [{ "simple": { "Text": "e" } }],
                              "redirect": {
                                "stdin": false,
                                "stdout": false,
                                "stderr": false,
                                "append": false,
                                "duplicate_out": false,
                                "__unused": 0,
                              },
                              "redirect_file": null,
                            },
                          },
                        ],
                      },
                    ],
                  ],
                },
              },
            ],
          },
        ],
      };

      let result = JSON.parse(parse`if a; then b; elif c; then d; else e; fi`);
      expect(result).toEqual(expected);
    });

    describe("precedence", () => {
      test("in pipeline", () => {
        const expected = {
          "stmts": [
            {
              "exprs": [
                {
                  "pipeline": {
                    "items": [
                      {
                        "if": {
                          "cond": [
                            {
                              "exprs": [
                                {
                                  "cmd": {
                                    "assigns": [],
                                    "name_and_args": [{ "simple": { "Text": "echo" } }, { "simple": { "Text": "hi" } }],
                                    "redirect": {
                                      "stdin": false,
                                      "stdout": false,
                                      "stderr": false,
                                      "append": false,
                                      "duplicate_out": false,
                                      "__unused": 0,
                                    },
                                    "redirect_file": null,
                                  },
                                },
                              ],
                            },
                          ],
                          "then": [
                            {
                              "exprs": [
                                {
                                  "cmd": {
                                    "assigns": [],
                                    "name_and_args": [
                                      { "simple": { "Text": "echo" } },
                                      { "simple": { "Text": "lmao" } },
                                    ],
                                    "redirect": {
                                      "stdin": false,
                                      "stdout": false,
                                      "stderr": false,
                                      "append": false,
                                      "duplicate_out": false,
                                      "__unused": 0,
                                    },
                                    "redirect_file": null,
                                  },
                                },
                              ],
                            },
                          ],
                          "else_parts": [
                            [
                              {
                                "exprs": [
                                  {
                                    "cmd": {
                                      "assigns": [],
                                      "name_and_args": [
                                        { "simple": { "Text": "echo" } },
                                        { "simple": { "Text": "lol" } },
                                      ],
                                      "redirect": {
                                        "stdin": false,
                                        "stdout": false,
                                        "stderr": false,
                                        "append": false,
                                        "duplicate_out": false,
                                        "__unused": 0,
                                      },
                                      "redirect_file": null,
                                    },
                                  },
                                ],
                              },
                            ],
                          ],
                        },
                      },
                      {
                        "cmd": {
                          "assigns": [],
                          "name_and_args": [{ "simple": { "Text": "cat" } }],
                          "redirect": {
                            "stdin": false,
                            "stdout": false,
                            "stderr": false,
                            "append": false,
                            "duplicate_out": false,
                            "__unused": 0,
                          },
                          "redirect_file": null,
                        },
                      },
                    ],
                  },
                },
              ],
            },
          ],
        };

        const result = JSON.parse(parse`if echo hi; then echo lmao; else echo lol; fi | cat`);
        expect(result).toEqual(expected);
      });
    });
  });

  describe.todo("async", () => {
    TestBuilder.command`echo foo & && echo hi`
      .error('"&" is not allowed on the left-hand side of "&&"')
      .runAsTest("left side of binary not allowed");

    TestBuilder.command`echo hi && echo foo & && echo hi`
      .error('"&" is not allowed on the left-hand side of "&&"')
      .runAsTest("left side of binary not allowed 2");

    test("right side of binary works", () => {
      const expected = {
        "stmts": [
          {
            "exprs": [
              {
                "binary": {
                  "op": "And",
                  "left": {
                    "cmd": {
                      "assigns": [],
                      "name_and_args": [{ "simple": { "Text": "echo" } }, { "simple": { "Text": "hi" } }],
                      "redirect": {
                        "stdin": false,
                        "stdout": false,
                        "stderr": false,
                        "append": false,
                        "duplicate_out": false,
                        "__unused": 0,
                      },
                      "redirect_file": null,
                    },
                  },
                  "right": {
                    "async": {
                      "cmd": {
                        "assigns": [],
                        "name_and_args": [{ "simple": { "Text": "echo" } }, { "simple": { "Text": "foo" } }],
                        "redirect": {
                          "stdin": false,
                          "stdout": false,
                          "stderr": false,
                          "append": false,
                          "duplicate_out": false,
                          "__unused": 0,
                        },
                        "redirect_file": null,
                      },
                    },
                  },
                },
              },
            ],
          },
        ],
      };

      const result = JSON.parse(parse`echo hi && echo foo &`);
      expect(result).toEqual(expected);
    });

    test("pipeline", () => {
      const expected = {
        "stmts": [
          {
            "exprs": [
              {
                "async": {
                  "pipeline": {
                    "items": [
                      {
                        "cmd": {
                          "assigns": [],
                          "name_and_args": [{ "simple": { "Text": "echo" } }, { "simple": { "Text": "hi" } }],
                          "redirect": {
                            "stdin": false,
                            "stdout": false,
                            "stderr": false,
                            "append": false,
                            "duplicate_out": false,
                            "__unused": 0,
                          },
                          "redirect_file": null,
                        },
                      },
                      {
                        "cmd": {
                          "assigns": [],
                          "name_and_args": [{ "simple": { "Text": "echo" } }, { "simple": { "Text": "foo" } }],
                          "redirect": {
                            "stdin": false,
                            "stdout": false,
                            "stderr": false,
                            "append": false,
                            "duplicate_out": false,
                            "__unused": 0,
                          },
                          "redirect_file": null,
                        },
                      },
                    ],
                  },
                },
              },
            ],
          },
        ],
      };

      const result = JSON.parse(parse`echo hi | echo foo &`);
      expect(result).toEqual(expected);
    });
  });

  describe("bad syntax", () => {
    test("cmd subst edgecase", () => {
      const expected = {
        stmts: [
          {
            exprs: [
              {
                cmd: {
                  assigns: [],
                  name_and_args: [
                    { simple: { Text: "echo" } },
                    {
                      simple: {
                        cmd_subst: {
                          script: {
                            stmts: [
                              {
                                exprs: [
                                  {
                                    cmd: {
                                      assigns: [
                                        {
                                          label: "FOO",
                                          value: { simple: { Text: "bar" } },
                                        },
                                      ],
                                      name_and_args: [{ simple: { Var: "FOO" } }],
                                      redirect: {
                                        stdin: false,
                                        stdout: false,
                                        stderr: false,
                                        append: false,
                                        duplicate_out: false,
                                        __unused: 0,
                                      },
                                      redirect_file: null,
                                    },
                                  },
                                ],
                              },
                            ],
                          },
                          quoted: false,
                        },
                      },
                    },
                  ],
                  redirect: {
                    stdin: false,
                    stdout: false,
                    stderr: false,
                    append: false,
                    duplicate_out: false,
                    __unused: 0,
                  },
                  redirect_file: null,
                },
              },
            ],
          },
        ],
      };
      const result = JSON.parse(parse`echo $(FOO=bar $FOO)`);
      expect(result).toEqual(expected);
    });

    test("cmd edgecase", () => {
      const expected = {
        "stmts": [
          {
            "exprs": [
              {
                "assign": [
                  { "label": "FOO", "value": { "simple": { "Text": "bar" } } },
                  { "label": "BAR", "value": { "simple": { "Text": "baz" } } },
                ],
              },
            ],
          },
          {
            "exprs": [
              {
                "cmd": {
                  "assigns": [{ "label": "BUN_DEBUG_QUIET_LOGS", "value": { "simple": { "Text": "1" } } }],
                  "name_and_args": [{ "simple": { "Text": "echo" } }],
                  "redirect": {
                    "stdin": false,
                    "stdout": false,
                    "stderr": false,
                    "append": false,
                    "duplicate_out": false,
                    "__unused": 0,
                  },
                  "redirect_file": null,
                },
              },
            ],
          },
        ],
      };
      const result = JSON.parse(parse`FOO=bar BAR=baz; BUN_DEBUG_QUIET_LOGS=1 echo`);
      expect(result).toEqual(expected);
    });
  });
});

describe("parse shell invalid input", () => {
  test("invalid js obj", async () => {
    const file = new Uint8Array(420);
    await TestBuilder.command`${file} | cat`.error(`expected a command or assignment but got: "JSObjRef"`).run();
  });

  test("subshell", async () => {
    await TestBuilder.command`echo (echo foo && echo hi)`.error("Unexpected token: `(`").run();

    await TestBuilder.command`echo foo >`.error("Redirection with no file").run();
  });

  test("throws when if clauses are nested too deeply", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const depth = 20000;
        const src = "if true; then ".repeat(depth) + "echo x" + "; fi".repeat(depth);
        try {
          Bun.$\`\${{ raw: src }}\`;
          console.log("parsed");
        } catch (e) {
          console.log("error:", e.message);
        }
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("error: Nesting depth exceeded\n");
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });
});
