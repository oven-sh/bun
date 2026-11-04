# What a program has printed is still in a buffer when it ends with an exception, if standard output is not a terminal. Which comes
# first, that or the traceback, when both go to the same place?
import concurrent.futures
import os
import subprocess
import sys
import tempfile

PROGRAM = "import sys\nprint('printed')\n%s\n"
ENDINGS = {
    'exception': "1 / 0",
    'exit with a message': "sys.exit('message')",
    'to stderr': "sys.stderr.write('written\\n')",
    'hook': "sys.excepthook = lambda *a: print('hook'); 1 / 0",
}
WAYS = {
    '-c': lambda program: (['-c', program], None),
    '-m': lambda program: (['-m', 'program'], None),
    'file': lambda program: (['program.py'], None),
    'stdin': lambda program: ([], program),
    '-u -c': lambda program: (['-u', '-c', program], None),
    '-i file': lambda program: (['-i', 'program.py'], ''),
    'directory': lambda program: (['package'], None),
}


def run(directory, arguments, text):
    result = subprocess.run([sys.executable] + arguments, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, cwd=directory, input=text)
    return result.returncode, [line for line in result.stdout.splitlines() if not line.startswith(' ')]


with tempfile.TemporaryDirectory() as top, concurrent.futures.ThreadPoolExecutor(8) as pool:
    results = []
    for number, (name, ending) in enumerate(ENDINGS.items()):
        program = PROGRAM % ending
        directory = os.path.join(top, str(number))
        os.makedirs(os.path.join(directory, 'package'))
        for path in ('program.py', 'package/__main__.py'):
            with open(os.path.join(directory, path), 'w') as f:
                f.write(program)
        for way, make in WAYS.items():
            results.append((name, way, pool.submit(run, directory, *make(program))))
    for name, way, result in results:
        print(name, '|', way, '|', *result.result())
