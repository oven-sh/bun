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

describe("parse shell interpolated array", () => {
  const text = (t: string) => ({ simple: { Text: t } });
  const joined = (...texts: string[]) => ({
    compound: { atoms: texts.map(t => ({ Text: t })), brace_expansion_hint: false, glob_hint: false },
  });
  const cmd = (script: string) => JSON.parse(script).stmts[0].exprs[0].cmd;

  test("in an argument each element is one atom, the same as typed words", () => {
    expect(parse`echo ${["a", "b"]} c`).toBe(parse`echo a b c`);
    expect(parse`${["echo", "a", "b"]} c`).toBe(parse`echo a b c`);
    expect(parse`echo ${[]} a ${[[], "b", []]} ${["c"]}`).toBe(parse`echo a b c`);
    expect(parse`env A=${["a", "b"]} c`).toBe(parse`env A=a b c`);
  });

  test("in an assignment value the elements are one atom", () => {
    const { assigns, name_and_args } = cmd(parse`A=${["a", "b"]} B=x${["c", "d"]}y C=${[]} cmd`);
    expect(assigns).toEqual([
      { label: "A", value: joined("a", " ", "b") },
      { label: "B", value: joined("xc", " ", "dy") },
      { label: "C", value: text("") },
    ]);
    expect(name_and_args).toEqual([text("cmd")]);
  });

  test("in an export operand that begins with a typed NAME= the elements are one atom", () => {
    expect(cmd(parse`export A=${["a", "b"]} "B="${["c", "d"]} ${["e", "f"]} ${["G=g", "h"]}`).name_and_args).toEqual([
      text("export"),
      joined("A=a", " ", "b"),
      joined("B=", "c", " ", "d"),
      text("e"),
      text("f"),
      text("G=g"),
      text("h"),
    ]);
  });

  test("typed text that spells a keyword at the end of a longer word is a part of that word", () => {
    const { assigns, name_and_args, redirect_file } = cmd(
      parse`A="x"then${[[], "y"]} B=${["x", []]}fi${[[], "y", "z"]} export C='x'else${[[], "y"]} > "x"elif${[[], "y"]}`,
    );
    expect(assigns).toEqual([
      { label: "A", value: joined("x", "then", " ", "y") },
      { label: "B", value: joined("x", " ", "fi", " ", "y", " ", "z") },
    ]);
    expect(name_and_args).toEqual([text("export"), joined("C=", "x", "else", " ", "y")]);
    expect(redirect_file).toEqual({ atom: text("") });
  });

  test("in [[ ]] an array parses like typed words", () => {
    expect(parse`[[ ${["a", "==", "b"]} ]]`).toBe(parse`[[ a ${"=="} b ]]`);
    expect(parse`[[ ${["-n", "a"]} ]]`).toBe(parse`[[ -n a ]]`);
    expect(() => parse`[[ -n ${["a", "b"]} ]]`).toThrow('Expected "]]" but got: b');
  });

  test("as a redirect target, one element is the file and two or more are a target with no word", () => {
    const ambiguous = { atom: text("") };
    expect(cmd(parse`echo hi > ${["a"]}`).redirect_file).toEqual({ atom: text("a") });
    expect(cmd(parse`echo hi > ${["a", "b"]}`).redirect_file).toEqual(ambiguous);
    expect(cmd(parse`echo hi > x${["a", "b"]}y`).redirect_file).toEqual(ambiguous);
    const buf = new Uint8Array(1);
    expect(cmd(parse`echo hi > ${[buf]}`).redirect_file).toEqual({ jsbuf: { idx: 0 } });
    expect(cmd(parse`echo hi > ${[buf, "a"]}`).redirect_file).toEqual(ambiguous);
    expect(cmd(parse`echo hi > ${["a", buf, "b"]}`).redirect_file).toEqual(ambiguous);
    expect(cmd(parse`echo hi 2>&1 ${["a", "b"]}`).redirect_file).toEqual(ambiguous);
    expect(cmd(parse`echo hi 1>&2 ${[buf, "a"]}`).redirect_file).toEqual(ambiguous);
    // A second redirect is an error after any target.
    expect(() => parse`echo hi > ${["a", buf]}> x`).toThrow('expected a command or assignment but got: "Redirect"');
    expect(() => parse`echo hi > ${["a"]} > x`).toThrow('expected a command or assignment but got: "Redirect"');

    // No element is left for the command or for a second command.
    for (const script of [
      parse`echo hi > ${["a", "echo", "INJECTED"]}; next`,
      parse`echo hi > ${["a", buf]}tail; next`,
      parse`echo hi > ${["a", buf, "b", buf]}$(tail); next`,
    ]) {
      expect(
        JSON.parse(script).stmts.map((stmt: any) => stmt.exprs.map((expr: any) => expr.cmd.name_and_args)),
      ).toEqual([[[text("echo"), text("hi")]], [[text("next")]]]);
    }
  });

  test("in a command name or argument, an array parses like its elements as separate values with a blank between them", () => {
    const buf = () => new Uint8Array(1);
    // "@" is where the array goes.
    // prettier-ignore
    const shapes = [
      "echo @", "echo @ tail", "echo pre@post", "echo @@", "@", "@ tail", "cmd x @ | cat", "echo $(echo @) y", "(echo @)",
      "env A=@ cmd", "basename A=@", "echo @ > out", "if @; then echo y; fi", "if true; then @; fi",
      "echo {@,c}", "echo *.@", "echo ~@", "echo $V@", "echo a#@", "echo \\@", "export @", "export -p @", "[[ @ ]]", "[[ a @ ]]",
      "i@; then echo a; fi", "if true; the@; fi", "if true; then echo a; f@", "if false; then echo a; els@; fi",
      "if@; then echo a; fi", "if true; then@; fi", "[[@ ]]", "[[ a == b ]]@",
      "true && if@; then echo a; fi", "true || if@; then echo a; fi", "true | if@; then cat; fi", "true; if@; then echo a; fi",
      "true\nif@; then echo a; fi", "(if@; then echo a; fi)", "echo $(if@; then echo a; fi)", 'echo "$(if@; then echo a; fi)"',
      "(true) if@; then echo a; fi", "[[ a == a ]] if@; then echo a; fi", "echo > out if@; then echo a; fi",
      "if false; then echo a; elif@; then echo b; fi", "if false; then echo a; else@; fi", "if true; then echo a; fi@",
      'echo "x"if@', "echo $V''fi@",
    ];
    const arrays: [string, () => unknown[]][] = [
      ['["x","y"]', () => ["x", "y"]],
      ['["a b","*","$HOME"]', () => ["a b", "*", "$HOME"]],
      ['[buf,"y"]', () => [buf(), "y"]],
      ['["x",buf]', () => ["x", buf()]],
      ['["","y"]', () => ["", "y"]],
      ['[1,"FOO=1"]', () => [1, "FOO=1"]],
      ['["f","y"]', () => ["f", "y"]],
      ['["n","y"]', () => ["n", "y"]],
      ['["e","y"]', () => ["e", "y"]],
      ['["i","y"]', () => ["i", "y"]],
      ['["-n","x","y"]', () => ["-n", "x", "y"]],
      ['["==","x","y"]', () => ["==", "x", "y"]],
      ['[[],"x",[]]', () => [[], "x", []]],
      ['[[],"-n","x"]', () => [[], "-n", "x"]],
    ];
    const run = (strings: string[], values: unknown[]) => {
      try {
        return parse({ raw: strings } as any, ...values);
      } catch (e) {
        return "throws: " + (e as Error).message;
      }
    };
    const differing: string[] = [];
    for (const shape of shapes) {
      const parts = shape.split("@");
      for (const [name, make] of arrays) {
        const values = parts.slice(1).map(make);
        const strings = [parts[0]];
        for (const [i, array] of values.entries()) strings.push(...array.slice(1).map(() => " "), parts[i + 1]);
        if (run(parts, values) !== run(strings, values.flat()))
          differing.push(shape.replaceAll("@", "${" + name + "}"));
      }
    }
    expect(differing).toEqual([]);
  });

  describe("as its own word, at the start, at the end and at every blank of a script", () => {
    const scripts = [
      "FOO=bar BAR=baz cmd a b > out.txt",
      "a | b && c || d; e $X $(f g)",
      "if [[ -n $A ]]; then echo {a,b}*.ts ~/x; elif false; then echo b; else (cd /; ls); fi",
      "cmd 2>&1 | grep x",
      "cmd < in.txt >> log.txt",
      "cmd &> out.txt",
      "[[ a == b ]] || echo no",
      "export FOO=bar BAZ=qux",
      "A=1; echo $A",
    ];
    const run = (strings: string[], ...values: unknown[]) => {
      try {
        return parse({ raw: strings } as any, ...values);
      } catch (e) {
        return "throws: " + (e as Error).message;
      }
    };
    // The templates where `value` does not parse like `same`.
    const differing = (value: unknown, same: (before: string, after: string) => string) => {
      const out: string[] = [];
      for (const script of scripts) {
        const blanks = [...script.matchAll(/ /g)].map(match => match.index);
        for (const [before, after] of [
          ["", " " + script],
          ...blanks.map(i => [script.slice(0, i) + " ", script.slice(i)]),
          [script + " ", ""],
        ]) {
          if (run([before, after], value) !== same(before, after)) out.push(before + "${}" + after);
        }
      }
      return out;
    };

    test("an array with no elements parses like the script without it", () => {
      expect(differing([], (before, after) => run([(before + after).trim()]))).toEqual([]);
    });

    test("an array of one element parses like that element", () => {
      expect(differing(["x"], (before, after) => run([before, after], "x"))).toEqual([]);
    });

    test("an array of two elements parses like two typed words, but not as a redirect target", () => {
      expect(differing(["x", "y"], (before, after) => run([before + "x y" + after]))).toEqual([
        "FOO=bar BAR=baz cmd a b > ${} out.txt",
        "cmd 2>&1 ${} | grep x",
        "cmd < ${} in.txt >> log.txt",
        "cmd &> ${} out.txt",
      ]);
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
