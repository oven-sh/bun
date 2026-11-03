# A symbolic link to the interpreter is the interpreter, whatever the name of the link and whatever the parent puts in argv[0],
# and sys.executable is the link.
import os, subprocess, sys, tempfile

CODE = "import sys; print('ran', sys.argv[1], sys.executable == sys.argv[2] or sys.executable)"

def run(program, what, expected, **options):
    done = subprocess.run([program, "-c", CODE, what, expected], capture_output=True, text=True, **options)
    print(done.returncode, done.stdout.strip().replace(d, "<d>"), done.stderr.strip()[:60])

with tempfile.TemporaryDirectory() as d:
    d = os.path.realpath(d)
    for name in ["other", "python3", "a name with spaces", "bun", "x.py"]:
        link = os.path.join(d, name)
        os.symlink(sys.executable, link)
        run(link, name, link)

    # A link to a link to a link.
    previous = os.path.join(d, "other")
    for i in range(4):
        link = os.path.join(d, "hop%d" % i)
        os.symlink(previous, link)
        previous = link
    run(previous, "hops", previous)

    # A relative target, and a relative path to the link.
    sub = os.path.join(d, "sub")
    os.mkdir(sub)
    relative = os.path.join(sub, "relative")
    os.symlink(os.path.join("..", "other"), relative)
    run(relative, "relative target", relative)
    run("./relative", "relative path", relative, cwd=sub)
    run("sub/relative", "relative path with a directory", relative, cwd=d)
    run("../sub/./relative", "a path that is not normal", relative, cwd=sub)

    # Found on PATH.
    run("other", "on PATH", os.path.join(d, "other"), env={**os.environ, "PATH": d})
    run("../" * 40 + relative, "up beyond the root", relative, cwd=sub)
    run(sub + "/../sub//./relative", "absolute and not normal", relative)
    path = os.environ.get("PATH")
    os.environ["PATH"] = d
    try:
        pid = os.posix_spawnp("other", ["other", "-c", "raise SystemExit(7)"], os.environ)
        print(os.waitstatus_to_exitcode(os.waitpid(pid, 0)[1]))
        print(os.spawnvp(os.P_WAIT, "hop3", ["hop3", "-c", "raise SystemExit(8)"]))
    finally:
        if path is None:
            del os.environ["PATH"]
        else:
            os.environ["PATH"] = path

    # argv[0] is whatever the parent says. (What sys.executable is then is another matter: CPython has only argv[0] to go by.)
    for argv0 in ("something", "bun", "/nowhere/python3"):
        for executable in (os.path.join(d, "other"), sys.executable):
            done = subprocess.run([argv0, "-c", "import sys; print('ran', sys.orig_argv[0])"], executable=executable, capture_output=True, text=True)
            print(done.returncode, done.stdout.strip(), done.stderr.strip()[:60])
