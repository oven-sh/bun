import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir, tmpdirSync } from "harness";
import { join } from "path";

describe.concurrent("run-shell", () => {
  test("running a shell script works", async () => {
    const dir = tmpdirSync();
    mkdirSync(dir, { recursive: true });
    await Bun.write(join(dir, "something.sh"), "echo wah");
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(dir, "something.sh")],
      cwd: dir,
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    const stdout = await proc.stdout.text();
    const stderr = await proc.stderr.text();
    console.log(stderr);
    expect(stdout).toEqual("wah\n");
  });

  test("invalid syntax reports the error correctly", async () => {
    const dir = tmpdirSync("bun-shell-test-error");
    mkdirSync(dir, { recursive: true });
    const shellScript = `-h)
  echo "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"`;
    await Bun.write(join(dir, "scripts", "script.sh"), shellScript);
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(dir, "scripts", "script.sh")],
      cwd: dir,
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });
    const stderr = await proc.stderr.text();
    expect(stderr).toBe("error: Failed to run script.sh due to error Unexpected ')'\n");
  });
});

// Why Bun's shell does not give what sh gives for a row of `paramRows`.
const EMPTY = "sh keeps an empty word that is in double quotes (#44904)";
const STOPS = "sh stops the script at a ${NAME:?word} that fails (#20368)";
const SPLITS = "sh splits the value of a variable at whitespace";
const PREFIX = "sh reads an earlier assignment of the same command (#45371)";
const QUOTE = "a quote in the word: Bun's shell gives what dash gives";

// A script, what bash 5.2 prints for it and whether it succeeds (default: it does). Then, where Bun's shell
// differs: what it prints, whether it succeeds, and why. `./args.sh` prints each of its arguments in `<>`.
type ParamRow = [script: string, stdout: string, ok?: boolean, bun?: [stdout: string, ok: boolean, why: string]];
// prettier-ignore
const paramRows: ParamRow[] = [
  ["./args.sh ${X:-a b}", "<a><b>\n"],
  ["./args.sh \"${X:-a b}\"", "<a b>\n"],
  ["./args.sh ${X:-\"a b\"}", "<a b>\n"],
  ["./args.sh ${X:-'a b'}", "<a b>\n"],
  ["./args.sh \"${X:-'a b'}\"", "<'a b'>\n"],
  ["./args.sh \"${X:-\"a b\"}\"", "<a b>\n"],
  ["./args.sh \"${X:-\"a  b\"}\"", "<a  b>\n"],
  ["./args.sh ${X:-a\\ b}", "<a b>\n"],
  ["./args.sh ${X:-a\\}b}", "<a}b>\n"],
  ["./args.sh \"${X:-a\\}b}\"", "<a}b>\n"],
  ["./args.sh \"${X:-a\\\\b}\"", "<a\\b>\n"],
  ["./args.sh ${X:-}", "\n"],
  ["./args.sh \"${X:-}\"", "<>\n", true, ["\n", true, EMPTY]],
  ["./args.sh pre${X:-a b}post", "<prea><bpost>\n"],
  ["./args.sh pre${X:- a }post", "<pre><a><post>\n"],
  ["./args.sh ${X:-  a   b  }", "<a><b>\n"],
  ["./args.sh ${X:-$Y}", "\n"],
  ["./args.sh ${X:-$(echo c d)}", "<c><d>\n"],
  ["./args.sh \"${X:-$(echo c d)}\"", "<c d>\n"],
  ["./args.sh ${X:-${Y:-z w}}", "<z><w>\n"],
  ["./args.sh ${X:-~}", "</home/user>\n"],
  ["./args.sh ${X:-~/foo}", "</home/user/foo>\n"],
  ["./args.sh \"${X:-~/foo}\"", "<~/foo>\n"],
  ["./args.sh ${X:-a;b}", "<a;b>\n"],
  ["./args.sh ${X:-a|b}", "<a|b>\n"],
  ["./args.sh ${X:->f}", "<>f>\n"],
  ["./args.sh ${X:-{a,b}}", "<{a,b}>\n"],
  ["./args.sh ${X:-a}b}", "<ab}>\n"],
  ["./args.sh ${X:-\"}\"}", "<}>\n"],
  ["./args.sh \"${X:-\"}\"}\"", "<}>\n"],
  ["./args.sh ${X:-'}'}", "<}>\n"],
  ["./args.sh \"${X:-'}'}\"", "<'}'>\n", true, ["<''}>\n", true, QUOTE]],
  ["./args.sh ${X:-\"\" b}", "<><b>\n"],
  ["./args.sh ${X:-\"\"}", "<>\n"],
  ["./args.sh ${X:-''}", "<>\n"],
  ["./args.sh ${X:+a b}", "\n"],
  ["./args.sh ${X+a}", "\n"],
  ["./args.sh ${X-a}", "<a>\n"],
  ["./args.sh ${X:-#c}", "<#c>\n"],
  ["./args.sh ${X:-a#c}", "<a#c>\n"],
  ["./args.sh ${X:-a\nb}", "<a><b>\n"],
  ["./args.sh \"${X:-a\nb}\"", "<a\nb>\n"],
  ["./args.sh ${X:-a\\\nb}", "<ab>\n"],
  ["./args.sh ${X:=a b}; ./args.sh \"$X\"", "<a><b>\n<a b>\n", true, ["<a b>\n<a b>\n", true, SPLITS]],
  ["./args.sh \"${X:=a b}\"; ./args.sh \"$X\"", "<a b>\n<a b>\n"],
  ["./args.sh ${1:-pos}", "<pos>\n"],
  ["./args.sh ${0:+zero}", "<zero>\n"],
  ["./args.sh ${X:-ar*}", "<args.sh>\n"],
  ["./args.sh \"${X:-*}\"", "<*>\n"],
  ["./args.sh \"${X:-\"a\\}b\"}\"", "<a}b>\n"],
  ["./args.sh ${X:-\"a\\}b\"}", "<a\\}b>\n", true, ["<a}b>\n", true, QUOTE]],
  ["./args.sh ${X:-'a\\}b'}", "<a\\}b>\n"],
  ["./args.sh \"${X:-a\\\"b}\"", "<a\"b>\n"],
  ["./args.sh \"${X:-a\"b}c\"d}\"", "<ab}cd>\n"],
  ["./args.sh ${X:-a\"b}c\"d}", "<ab}cd>\n"],
  ["./args.sh \"${X:-$'x'}\"", "<x>\n", true, ["<$'x'>\n", true, QUOTE]],
  ["./args.sh ${X:-a\\\\b}", "<a\\b>\n"],
  ["./args.sh ${X:-\\$Y}", "<$Y>\n"],
  ["./args.sh \"${X:-\\$Y}\"", "<$Y>\n"],
  ["./args.sh ${X:-\\\"}", "<\">\n"],
  ["./args.sh \"${X:-`echo q r`}\"", "<q r>\n"],
  ["./args.sh ${X:-`echo q r`}", "<q><r>\n"],
  ["./args.sh ${X:-a\"b c\"d e}", "<ab cd><e>\n"],
  ["./args.sh pre${X:-}post", "<prepost>\n"],
  ["./args.sh pre\"${X:-a b}\"post", "<prea bpost>\n"],
  ["./args.sh ${X:-\"$Y\"}", "<>\n", true, ["\n", true, EMPTY]],
  ["./args.sh ${X:-\"$Y\" z}", "<><z>\n", true, ["<z>\n", true, EMPTY]],
  ["./args.sh a${X:-~}", "<a/home/user>\n"],
  ["./args.sh ${X:-a~}", "<a~>\n"],
  ["./args.sh ${X:-\ttab\tsep}", "<tab><sep>\n"],
  ["./args.sh ${X:-a}${X:-b}", "<ab>\n"],
  ["./args.sh \"${X:-a}${X:-b}\"", "<ab>\n"],
  ["./args.sh ${X:-a}\" \"${X:-b}", "<a b>\n"],
  ["./args.sh ${X:-ar**}", "<args.sh>\n"],
  ["./args.sh ${X?}", "", false],
  ["./args.sh ${X:?}", "", false],
  ["./args.sh ${X:?custom msg}", "", false],
  ["./args.sh ${X?custom $HOME}", "", false],
  ["./args.sh ${1:?}", "", false],
  ["./args.sh ${X:=}; ./args.sh \"[$X]\"", "\n<[]>\n"],
  ["./args.sh ${1:=v}", "", false],
  ["X=; ./args.sh ${X=unset-only}; ./args.sh ${X:=now}; ./args.sh \"$X\"", "\n<now>\n<now>\n"],
  ["X=; ./args.sh ${X+set}; ./args.sh ${X:+nonnull}; ./args.sh ${X-dflt}; ./args.sh ${X:-dflt}", "<set>\n\n\n<dflt>\n"],
  ["X=v; ./args.sh ${X+set}; ./args.sh ${X:+nonnull}; ./args.sh ${X-dflt}; ./args.sh ${X:-dflt}; ./args.sh ${X?e}; ./args.sh ${X:=z}", "<set>\n<nonnull>\n<v>\n<v>\n<v>\n<v>\n"],
  ["./args.sh ${X:-$(echo a; echo b)}", "<a><b>\n"],
  ["./args.sh ${X:-a}; echo ${X:?stop}; echo after", "<a>\n", false, ["<a>\nafter\n", true, STOPS]],
  ["echo ${X:?in pipe} | cat; echo after", "after\n"],
  ["echo $(echo ${X:?in subst}); echo after", "\nafter\n"],
  ["(echo ${X:?in subshell}); echo after", "after\n"],
  ["Y=${X:?in assign}; echo after", "", false, ["after\n", true, STOPS]],
  ["Y=${X:?in prefix} echo cmd; echo after", "", false, ["after\n", true, STOPS]],
  ["echo a > ${X:?in redirect}; echo after", "", false, ["after\n", true, STOPS]],
  ["if echo ${X:?in if}; then echo yes; else echo no; fi; echo after", "", false, ["no\nafter\n", true, STOPS]],
  ["echo ${X:?a} || echo or; echo after", "", false, ["or\nafter\n", true, STOPS]],
  ["echo ${X:?a} && echo and; echo after", "", false, ["after\n", true, STOPS]],
  ["A=x B=${A:-y} sh -c 'echo \"[$B]\"'", "[x]\n", true, ["[y]\n", true, PREFIX]],
  ["A=x B=${A:+alt} sh -c 'echo \"[$B]\"'", "[alt]\n", true, ["[]\n", true, PREFIX]],
  ["TERM_OVERRIDE=\"${TURBO_HASH:+dumb}\" TERMX=${TERM_OVERRIDE:-fallback} sh -c 'echo \"[$TERMX]\"'", "[fallback]\n"],
  ["TURBO_HASH=1; TERM_OVERRIDE=\"${TURBO_HASH:+dumb}\" TERMX=${TERM_OVERRIDE:-fallback} sh -c 'echo \"[$TERMX]\"'", "[dumb]\n", true, ["[fallback]\n", true, PREFIX]],
  ["Y=${X:-a b}; ./args.sh \"$Y\"", "<a b>\n"],
  ["Y=\"${X:-a b}\"; ./args.sh \"$Y\"", "<a b>\n"],
  ["export Y=${X:-a b}; ./args.sh \"$Y\"", "<a b>\n"],
  ["./args.sh ${X:-a}${X:-b c}d", "<ab><cd>\n"],
  ["./args.sh x${X:+y}z", "<xz>\n"],
  ["X=v; ./args.sh x${X:+y}z", "<xyz>\n"],
  ["X=v; ./args.sh ${X:+--flag $X}", "<--flag><v>\n"],
  ["X=\"a b\"; ./args.sh ${X:-d}", "<a><b>\n", true, ["<a b>\n", true, SPLITS]],
  ["X=\"a b\"; ./args.sh ${X:+$X}", "<a><b>\n", true, ["<a b>\n", true, SPLITS]],
  ["X=\"a b\"; ./args.sh \"${X:+$X}\"", "<a b>\n"],
  ["./args.sh ${X:-$Y}end", "<end>\n"],
  ["./args.sh ${X:-\"a\"'b'c}", "<abc>\n"],
  ["./args.sh ${X:-a\"b\"}", "<ab>\n"],
  ["./args.sh ${X:-one two three}", "<one><two><three>\n"],
  ["./args.sh \"pre ${X:-mid dle} post\"", "<pre mid dle post>\n"],
  ["./args.sh ${X:-${Y:-${Z:-deep}}}", "<deep>\n"],
  ["./args.sh ${X:-${Y:+no}${Z:-yes}}", "<yes>\n"],
  ["./args.sh ${X:=one} ${X:=two} $X", "<one><one><one>\n"],
  ["./args.sh ${X:=a b} \"$X\"", "<a><b><a b>\n", true, ["<a b><a b>\n", true, SPLITS]],
  ["./args.sh \"${X:=a b}\" \"$X\"", "<a b><a b>\n"],
  ["X=1; ./args.sh ${X:?no} ${X?no}", "<1><1>\n"],
  ["./args.sh ${X:-a} > out1.txt; cat out1.txt", "<a>\n"],
  ["echo hi > ${X:-out2.txt}; cat out2.txt", "hi\n"],
  ["[[ -n ${X:-v} ]] && echo nonempty", "nonempty\n"],
  ["[[ -z ${X:-} ]] && echo empty", "empty\n"],
  ["[[ ${X:-a} == a ]] && echo eq", "eq\n"],
  ["./args.sh $(echo ${X:-in subst})", "<in><subst>\n"],
  ["./args.sh \"$(echo ${X:-in subst})\"", "<in subst>\n"],
  ["./args.sh `echo ${X:-bt}`", "<bt>\n"],
  ["(X=inner; ./args.sh ${X:-d}); ./args.sh ${X:-d}", "<inner>\n<d>\n"],
  ["(: ${X:=inner}); ./args.sh \"[$X]\"", "<[]>\n"],
  ["echo ${X:=piped} | cat; ./args.sh \"[$X]\"", "piped\n<[]>\n"],
  ["./args.sh ${X:-a} | cat", "<a>\n"],
  ["./args.sh ${HOME:+set} ${HOME:-unset}", "<set></home/user>\n"],
  ["./args.sh ${X:-'single quoted'} ${X:-\"double quoted\"}", "<single quoted><double quoted>\n"],
  ["./args.sh ${X:-a\\ b} ${X:-a\\\\b}", "<a b><a\\b>\n"],
  ["./args.sh ${X:-$}", "<$>\n"],
  ["./args.sh ${X:-$ }", "<$>\n"],
  ["./args.sh ${X:-a$}", "<a$>\n"],
  ["./args.sh ${X:-}${X:-}", "\n"],
  ["./args.sh \"${X:-}\"x", "<x>\n"],
  ["./args.sh ${X:+}", "\n"],
  ["./args.sh \"a${X:-b}c\" 'a${X:-b}c' a\\${X:-b}c", "<abc><a${X:-b}c><a${X:-b}c>\n"],
  ["./args.sh ${X:-a} ${Y:-b} ${Z:-c}", "<a><b><c>\n"],
  ["./args.sh ${X}", "\n"],
  ["./args.sh \"${X}\"", "<>\n", true, ["\n", true, EMPTY]],
  ["./args.sh ${X}y", "<y>\n"],
  ["X=1; ./args.sh ${X} \"${X}\" ${X}y $X${X} ${X}${X}", "<1><1><1y><11><11>\n"],
  ["./args.sh ${0} | grep -c .", "1\n"],
  ["./args.sh ${X:-\"$(echo q1  q2)\"}", "<q1 q2>\n"],
  ["./args.sh ${X:-$(echo q1  q2) tail}", "<q1><q2><tail>\n"],
  ["./args.sh pre${X:-$(echo q1 q2)}post", "<preq1><q2post>\n"],
  ["./args.sh ${X:- $(echo q1) }post", "<q1><post>\n"],
  ["./args.sh ${X:-=} ${X:-+} ${X:--} ${X:-?}", "<=><+><-><?>\n"],
  ["./args.sh ${X-=} ${X=+}", "<=><+>\n"],
  ["./args.sh ${X:-a=b}", "<a=b>\n"],
  ["FOO=${X:-bar}; ./args.sh $FOO", "<bar>\n"],
  ["FOO=a${X:-bar}b; ./args.sh $FOO", "<abarb>\n"],
  ["./args.sh ${X:-#notcomment} #comment", "<#notcomment>\n"],
  ["./args.sh ${X:-{a,b}} {a,b}${X:-c}", "<{a,b}><ac><bc>\n"],
  ["./args.sh ${X:-a,b}", "<a,b>\n"],
  ["./args.sh {${X:-a},b}", "<a><b>\n"],
  ["./args.sh ~/x${X:- } ~/x${X:- y}", "</home/user/x></home/user/x><y>\n"],
  ["./args.sh ${X:-~abc} ${X:-~$Y} ${X:-~ b} a${X:-~/b}", "<~abc><~><~><b><a/home/user/b>\n"],
  ["./args.sh ${X:-a \"\" b} ${HOME:+name \"\"}", "<a><><b><name><>\n"],
  ["./args.sh x${X:-$Y $(echo a)} ${X:-$(echo a) $Y}y", "<x><a><a><y>\n"],
  ["[[ ${X:-a b} == \"a b\" ]] && echo one", "one\n"],
  ["[[ ${X:-a b} == ab ]] && echo glued", "", false],
  ["true \"${X:?}\" && echo RAN", "", false],
  ["X=1; true \"${X:?}\" && echo RAN", "RAN\n"],
  ["X=v; ./args.sh ${X:-{}} \"${X:-{}}\" ${X:+{m}}", "<v}><v}><{m}>\n"],
  ["./args.sh ${X:={}}; ./args.sh \"$X\"", "<{}>\n<{>\n"],
];

// `--shell=system` runs bash when there is one. bash 3.2 (macOS) and dash give other results for a few rows.
const bashVersion = await (async () => {
  const bash = Bun.which("bash", { PATH: bunEnv.PATH });
  if (!bash) return 0;
  await using proc = Bun.spawn({ cmd: [bash, "-c", 'echo "${BASH_VERSINFO[0]}.${BASH_VERSINFO[1]}"'], stdout: "pipe" });
  return Number(await proc.stdout.text());
})();

// Bun's shell runs package.json scripts by default on Windows. The system
// shell rows show that both shells give the same output.
describe.each(isWindows ? ["bun"] : ["bun", "system"])("package script with --shell=%s", shell => {
  const run = async (script: string, env: Record<string, string>, ...args: string[]) => {
    using dir = tempDir("run-shell-braced", {
      "package.json": JSON.stringify({ name: "braced-fixture", version: "1.2.3", scripts: { braced: script } }),
    });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", `--shell=${shell}`, "braced", ...args],
      cwd: String(dir),
      env: { ...bunEnv, ...env },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  };

  test("expands ${NAME}", async () => {
    const { stdout, exitCode } = await run(
      'echo ${BRACED_NAME} "${BRACED_VERSION}" ${npm_lifecycle_event}-x',
      { BRACED_NAME: "braced-fixture", BRACED_VERSION: "1.2.3" },
      "${BRACED_NAME}",
    );
    // The argument after the script name is data. It stays text.
    expect(stdout).toBe("braced-fixture 1.2.3 braced-x ${BRACED_NAME}\n");
    expect(exitCode).toBe(0);
  });

  test("expands ${NAME:-word} and ${NAME:+word}", async () => {
    const script = "echo --port ${BRACED_PORT:-3002} ${BRACED_HOST:+--host $BRACED_HOST} ${BRACED_NONE:+--none}";
    expect(await run(script, { BRACED_HOST: "localhost" })).toMatchObject({
      stdout: "--port 3002 --host localhost\n",
      exitCode: 0,
    });
    expect(await run(script, { BRACED_PORT: "8080" })).toMatchObject({ stdout: "--port 8080\n", exitCode: 0 });
  });

  // Each row runs in a subshell of one script, so that no row changes a variable of another row.
  test.skipIf(isWindows || (shell === "system" && bashVersion < 5.2))(
    "${NAME<op>word} gives what sh gives",
    async () => {
      const script = paramRows.map(([row]) => `echo @@row; (\n${row}\n) && echo @@ok || echo @@fail`).join("\n");
      using dir = tempDir("run-shell-param-rows", {
        "package.json": JSON.stringify({ name: "param-rows", scripts: { rows: script } }),
        "args.sh": `#!/bin/sh\nfor a in "$@"; do printf '<%s>' "$a"; done; printf '\\n'\n`,
      });
      chmodSync(join(String(dir), "args.sh"), 0o755);
      await using proc = Bun.spawn({
        cmd: [bunExe(), "run", `--shell=${shell}`, "rows"],
        cwd: String(dir),
        env: { ...bunEnv, HOME: "/home/user" },
        stdout: "pipe",
        stderr: "ignore",
      });
      const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
      const results = stdout
        .split("@@row\n")
        .slice(1)
        .map(result => [result.replace(/@@(ok|fail)\n$/, ""), result.endsWith("@@ok\n")]);
      expect(Object.fromEntries(paramRows.map(([row], index) => [row, results[index]]))).toEqual(
        Object.fromEntries(
          paramRows.map(([row, out, ok = true, bun]) => [row, shell === "bun" && bun ? [bun[0], bun[1]] : [out, ok]]),
        ),
      );
      expect(exitCode).toBe(0);
    },
  );

  test("a ${NAME:?} guard in an assignment stops the command", async () => {
    const script = "ENV=${BRACED_DEPLOY_ENV:?} echo deploying";
    const unset = await run(script, {});
    expect(unset.stderr).toContain("BRACED_DEPLOY_ENV: parameter");
    expect(unset.stdout).toBe("");
    expect(unset.exitCode).not.toBe(0);
    expect(await run(script, { BRACED_DEPLOY_ENV: "staging" })).toMatchObject({ stdout: "deploying\n", exitCode: 0 });
  });

  test("a ${NAME:?} guard stops the script when NAME is not set", async () => {
    const script = 'true "${BRACED_DEPLOY_ENV:?}" && echo deploying to $BRACED_DEPLOY_ENV';
    const unset = await run(script, {});
    expect(unset.stderr).toContain("BRACED_DEPLOY_ENV: parameter");
    expect(unset.stdout).toBe("");
    expect(unset.exitCode).not.toBe(0);
    expect(await run(script, { BRACED_DEPLOY_ENV: "staging" })).toMatchObject({
      stdout: "deploying to staging\n",
      exitCode: 0,
    });
  });
});

test.skipIf(isWindows)(
  "package script shell interpreter is resolved from the original PATH, not node_modules/.bin",
  async () => {
    // A dependency can place arbitrary executables named "bash"/"sh"/"zsh" into
    // node_modules/.bin via its "bin" field. The interpreter that runs
    // package.json scripts must never be picked up from there.
    const fakeShell = "#!/bin/sh\necho FAKE_SHELL_USED\n";
    using dir = tempDir("run-shell-interpreter", {
      "package.json": JSON.stringify({
        name: "shell-interpreter-fixture",
        version: "1.0.0",
        scripts: {
          "say-hi": "echo real-shell-ran",
        },
      }),
      "node_modules/.bin/bash": fakeShell,
      "node_modules/.bin/sh": fakeShell,
      "node_modules/.bin/zsh": fakeShell,
    });
    for (const name of ["bash", "sh", "zsh"]) {
      chmodSync(join(String(dir), "node_modules", ".bin", name), 0o755);
    }

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "say-hi"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // The script must run under a real system shell, not the executables a
    // dependency dropped into node_modules/.bin.
    expect(stdout).not.toContain("FAKE_SHELL_USED");
    expect(stderr).not.toContain("FAKE_SHELL_USED");
    expect(stdout).toContain("real-shell-ran");
    expect(exitCode).toBe(0);
  },
);
