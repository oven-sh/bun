import { $ } from "bun";
import { redirect } from "./util";

const BUN = process.argv0;

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

    const result = $.parse`echo foo`;
    expect(JSON.parse(result)).toEqual(expected);
  });

  test("basic redirect", () => {
    const expected = {
      "stmts": [
        {
          "exprs": [
            {
              "cmd": {
                "assigns": [],
                "name_and_args": [{ "simple": { "Text": "echo" } }, { "simple": { "Text": "foo" } }],
                "redirect": redirect({ stdout: true }),
                "redirect_file": { atom: { "simple": { "Text": "lmao.txt" } } },
              },
            },
          ],
        },
      ],
    };

    const result = JSON.parse($.parse`echo foo > lmao.txt`);
    expect(result).toEqual(expected);
  });

  test("compound atom", () => {
    const expected = {
      "stmts": [
        {
          "exprs": [
            {
              "cmd": {
                "assigns": [],
                "name_and_args": [
                  {
                    "compound": {
                      "atoms": [{ "Text": "FOO " }, { "Var": "NICE!" }],
                      brace_expansion_hint: false,
                      glob_hint: false,
                    },
                  },
                ],
                "redirect": redirect({}),
                "redirect_file": null,
              },
            },
          ],
        },
      ],
    };

    const result = JSON.parse($.parse`"FOO $NICE!"`);
    console.log("Result", JSON.stringify(result));
    expect(result).toEqual(expected);
  });

  test("pipelines", () => {
    const expected = {
      "stmts": [
        {
          "exprs": [
            {
              "pipeline": {
                "items": [
                  {
                    "cmd": {
                      "assigns": [],
                      "name_and_args": [{ "simple": { "Text": "echo" } }],
                      "redirect": redirect({ stdout: true }),
                      "redirect_file": { atom: { "simple": { "Text": "foo.txt" } } },
                    },
                  },
                  {
                    "cmd": {
                      "assigns": [],
                      "name_and_args": [{ "simple": { "Text": "echo" } }, { "simple": { "Text": "hi" } }],
                      "redirect": redirect({}),
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
    const result = JSON.parse($.parse`echo > foo.txt | echo hi`);
    // console.log(result);
    expect(result).toEqual(expected);
  });

  test("conditional execution", () => {
    const expected = {
      "stmts": [
        {
          "exprs": [
            {
              "cond": {
                "op": "Or",
                "left": {
                  "cond": {
                    "op": "And",
                    "left": {
                      "cmd": {
                        "assigns": [],
                        "name_and_args": [{ "simple": { "Text": "echo" } }, { "simple": { "Text": "foo" } }],
                        "redirect": redirect(),
                        "redirect_file": null,
                      },
                    },
                    "right": {
                      "cmd": {
                        "assigns": [],
                        "name_and_args": [{ "simple": { "Text": "echo" } }, { "simple": { "Text": "bar" } }],
                        "redirect": redirect(),
                        "redirect_file": null,
                      },
                    },
                  },
                },
                "right": {
                  "cmd": {
                    "assigns": [],
                    "name_and_args": [{ "simple": { "Text": "echo" } }, { "simple": { "Text": "lmao" } }],
                    "redirect": redirect(),
                    "redirect_file": null,
                  },
                },
              },
            },
          ],
        },
      ],
    };
    const result = JSON.parse($.parse`echo foo && echo bar || echo lmao`);
    // console.log(result);
    expect(result).toEqual(expected);
  });

  test("precedence", () => {
    const expected = {
      "stmts": [
        {
          "exprs": [
            {
              "cond": {
                "op": "And",
                "left": {
                  "cond": {
                    "op": "And",
                    "left": {
                      "assign": [{ "label": "FOO", "value": { "simple": { "Text": "bar" } } }],
                    },
                    "right": {
                      "cmd": {
                        "assigns": [],
                        "name_and_args": [{ "simple": { "Text": "echo" } }, { "simple": { "Text": "foo" } }],
                        "redirect": redirect(),
                        "redirect_file": null,
                      },
                    },
                  },
                },
                "right": {
                  "pipeline": {
                    "items": [
                      {
                        "cmd": {
                          "assigns": [],
                          "name_and_args": [{ "simple": { "Text": "echo" } }, { "simple": { "Text": "bar" } }],
                          "redirect": redirect(),
                          "redirect_file": null,
                        },
                      },
                      {
                        "cmd": {
                          "assigns": [],
                          "name_and_args": [{ "simple": { "Text": "echo" } }, { "simple": { "Text": "lmao" } }],
                          "redirect": redirect(),
                          "redirect_file": null,
                        },
                      },
                      {
                        "cmd": {
                          "assigns": [],
                          "name_and_args": [{ "simple": { "Text": "cat" } }],
                          "redirect": redirect({ stdout: true }),
                          "redirect_file": { atom: { "simple": { "Text": "foo.txt" } } },
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

    const result = $.parse`FOO=bar && echo foo && echo bar | echo lmao | cat > foo.txt`;
    // console.log(result);
    expect(JSON.parse(result)).toEqual(expected);
  });

  test("assigns", () => {
    const expected = {
      "stmts": [
        {
          "exprs": [
            {
              "cmd": {
                "assigns": [
                  { "label": "FOO", "value": { "simple": { "Text": "bar" } } },
                  { "label": "BAR", "value": { "simple": { "Text": "baz" } } },
                ],
                "name_and_args": [{ "simple": { "Text": "export" } }, { "simple": { "Text": "LMAO=nice" } }],
                "redirect": {
                  "stdin": false,
                  "stdout": false,
                  "stderr": false,
                  "append": false,
                  "__unused": 0,
                },
                "redirect_file": null,
              },
            },
          ],
        },
      ],
    };

    const result = JSON.parse($.parse`FOO=bar BAR=baz export LMAO=nice`);
    console.log("Result", JSON.stringify(result));
    expect(result).toEqual(expected);
  });

  test("redirect js obj", () => {
    const expected = {
      "stmts": [
        {
          "exprs": [
            {
              "cond": {
                "op": "And",
                "left": {
                  "cmd": {
                    "assigns": [],
                    "name_and_args": [{ "simple": { "Text": "echo" } }, { "simple": { "Text": "foo" } }],
                    "redirect": redirect({ stdout: true }),
                    "redirect_file": { "jsbuf": { "idx": 0 } },
                  },
                },
                "right": {
                  "cmd": {
                    "assigns": [],
                    "name_and_args": [{ "simple": { "Text": "echo" } }, { "simple": { "Text": "foo" } }],
                    "redirect": redirect({ stdout: true }),
                    "redirect_file": { "jsbuf": { "idx": 1 } },
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
    const result = JSON.parse($.parse`echo foo > ${buffer} && echo foo > ${buffer2}`);

    // console.log("Result", JSON.stringify(result));
    expect(result).toEqual(expected);
  });

  describe("bad syntax", () => {
    test("cmd subst edgecase", () => {
      const expected = {
        "stmts": [
          {
            "exprs": [
              {
                "cmd": {
                  "assigns": [],
                  "name_and_args": [
                    { "simple": { "Text": "echo" } },
                    {
                      "simple": {
                        "cmd_subst": {
                          "cmd": {
                            "assigns": [{ "label": "FOO", "value": { "simple": { "Text": "bar" } } }],
                            "name_and_args": [{ "simple": { "Var": "FOO" } }],
                            "redirect": {
                              "stdin": false,
                              "stdout": false,
                              "stderr": false,
                              "append": false,
                              "__unused": 0,
                            },
                            "redirect_file": null,
                          },
                        },
                      },
                    },
                  ],
                  "redirect": { "stdin": false, "stdout": false, "stderr": false, "append": false, "__unused": 0 },
                  "redirect_file": null,
                },
              },
            ],
          },
        ],
      };

      const result = JSON.parse($.parse`echo $(FOO=bar $FOO)`);
      expect(result).toEqual(expected);
    });

    test("cmd edgecase", () => {
      const result = $.parse`FOO=bar BAR=baz; BUN_DEBUG_QUIET_LOGS=1 echo`;
    });
  });
});

describe("parse shell invalid input", () => {
  function run(cb: Function): Error | undefined {
    try {
      cb();
    } catch (err) {
      return err as Error;
    }
    return undefined;
  }

  test("invalid js obj", () => {
    const error = run(() => {
      const file = new Uint8Array(1 << 20);
      const result = $.parse`${file} | cat`;
    });

    expect(error).toBeDefined();
  });
});
