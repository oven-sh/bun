# The order of finalizers at the end of the interpreter, of a program and of the modules that it imports. A function makes the namespace of its module a cycle; a module that is data only
# goes by reference counts: sys.modules is emptied, and each module goes when the last that holds it lets go. Each scene is a process of its own.
import os, subprocess, sys, tempfile

KINDS = "import sys\nclass A:\n    def __init__(self, n): self.n = n\n    def __del__(self): sys.__stdout__.write(self.n + ' ')\n"
DATA = "from kinds import A\nown = A('%s')\n"
CODE = "from kinds import A\ndef f(): pass\nown = A('%s')\n"
SCENES = {
    'modules that are data only': ({'m1': DATA % 'm1', 'm2': DATA % 'm2'}, "import kinds, m1, m2\nmine = kinds.A('main')\n"),
    'modules with functions': ({'m1': CODE % 'm1', 'm2': CODE % 'm2'}, "import kinds, m1, m2\nmine = kinds.A('main')\n"),
    'the object of the program is made before the imports': ({'m1': DATA % 'm1', 'm2': DATA % 'm2'}, "import kinds\nmine = kinds.A('main')\nimport m1, m2\n"),
    'a module that is data only imports another': ({'m2': DATA % 'm2', 'm1': "from kinds import A\nbefore = A('m1.before')\nimport m2\nafter = A('m1.after')\n"}, "import kinds, m1\nmine = kinds.A('main')\n"),
    'the program takes names out of the modules': ({'m1': DATA % 'm1', 'm2': DATA % 'm2'}, "from kinds import A\nfrom m1 import own as own1\nfrom m2 import own as own2\nmine = A('main')\n"),
}

with tempfile.TemporaryDirectory() as base:
    children = []
    for number, (name, (modules, program)) in enumerate(SCENES.items()):
        directory = os.path.join(base, str(number))
        os.mkdir(directory)
        for module, text in dict(modules, kinds=KINDS, program=program).items():
            with open(os.path.join(directory, module + '.py'), 'w') as file:
                file.write(text)
        children.append((name, subprocess.Popen([sys.executable, '-B', os.path.join(directory, 'program.py')], stdout=subprocess.PIPE, stderr=subprocess.STDOUT)))
    for name, child in children:
        text = child.communicate()[0].decode()
        print('%s: status %d: %s' % (name, child.returncode, text.strip()))
