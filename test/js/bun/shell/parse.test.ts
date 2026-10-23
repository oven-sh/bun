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

    describe("then, elif, else and fi directly after a compound command", () => {
      const ast = (script: string) => JSON.parse(parse`${{ raw: script }}`);
      const parseError = (script: string) => {
        try {
          ast(script);
        } catch (e) {
          return (e as Error).message;
        }
      };
      const wantsThen = 'Expected "then" but got: Eof';
      const wantsFi = 'Expected "else", "elif", or "fi" but got: Eof';

      // `@` is a command. The word after it is the word that the clause waits for.
      const slots = [
        "if @ then echo y; fi",
        "if true; then @ fi",
        "if false; then @ else echo b; fi",
        "if false; then @ elif true; then echo c; fi",
        "if false; then echo a; elif @ then echo c; fi",
        "if false; then echo a; elif true; then @ fi",
        "if false; then echo a; elif false; then @ else echo d; fi",
        "if false; then echo a; elif false; then @ elif true; then echo e; fi",
        "if false; then echo a; elif false; then echo c; else @ fi",
        "if false; then echo a; else @ fi",
      ];
      const compounds = ["(echo y)", "[[ a == a ]]", "if true; then echo y; fi"];
      const lists = ["", "true && ", "false || ", "echo y | ", "true && echo y | "];
      const everyPosition = slots.flatMap(slot =>
        compounds.flatMap(compound =>
          lists.map((list): [string, string] => [
            slot.replace("@", list + compound),
            slot.replace("@", list + compound + ";"),
          ]),
        ),
      );

      // [script, the same script with a separator before each word of the clause]
      test.each([
        ...everyPosition,

        // a word of the clause on both sides of a compound command
        ["if (true) then (echo y) fi", "if (true); then (echo y); fi"],
        ["if true; then (echo a) else (echo b) fi", "if true; then (echo a); else (echo b); fi"],
        [
          "if false; then echo a; elif (false) then echo b; elif [[ a == a ]] then (echo c) else (echo d) fi",
          "if false; then echo a; elif (false); then echo b; elif [[ a == a ]]; then (echo c); else (echo d); fi",
        ],
        [
          "if true; then if true; then if true; then echo y; fi fi fi",
          "if true; then if true; then if true; then echo y; fi; fi; fi",
        ],

        // no blank before the word, and a newline after it
        ["if true; then (echo y)fi", "if true; then (echo y); fi"],
        ["if true; then (echo a) else\n echo b; fi", "if true; then (echo a); else\n echo b; fi"],

        // inside a subshell and a command substitution
        ["(if true; then (echo y) fi)", "(if true; then (echo y); fi)"],
        ["echo $(if true; then (echo y) fi)", "echo $(if true; then (echo y); fi)"],
        ["echo `if true; then (echo y) fi`", "echo `if true; then (echo y); fi`"],
        ["if true; then ( if true; then (echo a) fi ) fi", "if true; then ( if true; then (echo a); fi ); fi"],

        // what follows the closing `fi`
        ["if true; then (echo y) fi; echo tail", "if true; then (echo y); fi; echo tail"],
        ["if true; then (echo y) fi\necho tail", "if true; then (echo y); fi\necho tail"],
        ["if true; then (echo y) fi && echo tail", "if true; then (echo y); fi && echo tail"],
        ["if true; then (echo y) fi || echo tail", "if true; then (echo y); fi || echo tail"],
        ["if true; then (echo y) fi | cat", "if true; then (echo y); fi | cat"],
        ["if true; then if true; then echo y; fi fi | cat", "if true; then if true; then echo y; fi; fi | cat"],

        // a comment between the compound command and the line of the word
        [
          "if true; then\n  if true; then\n    echo x\n  fi # inner\nfi",
          "if true; then\n  if true; then\n    echo x\n  fi\nfi",
        ],
        ["if true; then\n  (echo x) # note\nfi", "if true; then\n  (echo x)\nfi"],
        ["if true; then\n  [[ -n a ]] # note\nelse\n  echo b\nfi", "if true; then\n  [[ -n a ]]\nelse\n  echo b\nfi"],
      ])("%j", (script, separated) => {
        expect(ast(script)).toEqual(ast(separated));
      });

      // bash rejects each of these scripts.
      test.each([
        // A simple command stops at its redirection. The word after it is not a word of the clause.
        ...["", "(echo a) && ", "(echo a) | ", "(echo a) ", "[[ a == a ]] "].flatMap((before): [string, string][] => [
          [`if ${before}echo hi > /dev/null then echo y; fi`, wantsThen],
          [`if true; then ${before}echo hi > /dev/null fi`, wantsFi],
        ]),
        // the word is quoted, or is part of a longer word
        ['if true; then (echo hi) "fi"', wantsFi],
        ["if true; then (echo hi) fi$X", wantsFi],
        // `elif` is the word of the clause here, so it needs its `then`
        ["if false; then (echo a) elif true; fi", wantsThen],
      ])("%j fails with %j", (script, message) => {
        expect(parseError(script)).toBe(message);
      });

      test("`fi` after a simple command is an argument", () => {
        expect(ast("if true; then echo hi fi; fi").stmts[0].exprs[0].if.then).toEqual(ast("echo hi fi").stmts);
      });

      test("a word that the clause does not wait for does not end the statement", () => {
        const kinds = (stmts: any[]) => stmts.map(stmt => stmt.exprs.map(expr => Object.keys(expr)[0]));
        // No clause waits for `fi` at the top level, and a `then` body does not wait for `then`.
        expect(kinds(ast("(echo hi) fi").stmts)).toEqual([["subshell", "cmd"]]);
        expect(kinds(ast("if true; then (echo hi) then; fi").stmts[0].exprs[0].if.then)).toEqual([["subshell", "cmd"]]);
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
