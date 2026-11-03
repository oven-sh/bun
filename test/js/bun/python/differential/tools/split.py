#!/usr/bin/env python3
"""Rewrites a test so that a failure costs one line of output instead of the rest of the test.

usage: split.py SOURCE DESTINATION        (run with the oracle: it has to parse 3.15 syntax)

The tests are written compactly: print(a, b, c, ...) with dozens of expressions on a line.  One exception in such a line
would end the test.  This tool makes the version that run.py really runs, on both sides:

  * print(a, b, c)   outside functions and classes becomes   print('a =>', a); print('b =>', b); print('c =>', c),
    one per line (a literal argument stays with the value that follows it);
  * t(lambda: expr)  at module level is preceded by   print('expr =>', end=' ');
  * in a for loop at module level the labels also show the loop variables:   eval(e) [e='None + 1'] => ...;
  * every statement at module level that is not inside a try or a with is wrapped in
    try: ... except Exception as _pe: print('<!TypeError: message> in: source').

Under a correct implementation no '<!' line is ever printed (verify.py checks that for the oracle), so nothing about
what is tested changes.  Tests about uncaught exceptions and exit statuses, files that do not parse and files that say
'# split: no' are copied as they are.
"""
import ast, os, re, sys, warnings
warnings.simplefilter('ignore')

MARK = '<!'


def clip(text, n=72):
    text = ' '.join(text.split())
    return text if len(text) <= n else text[:n - 3] + '...'


class Splitter:
    def __init__(self, src):
        self.src = src
        self.lines = src.split('\n')
        self.raw = [l.encode('utf-8') for l in self.lines]
        self.out = [[l] for l in self.lines]        # what replaces each source line
        self.loops = []                             # the variables of the enclosing module-level for loops
        self.tree = ast.parse(src)

    # positions -----------------------------------------------------------------------------------------------------
    def before(self, node):
        return self.raw[node.lineno - 1][:node.col_offset].decode('utf-8')

    def after(self, node):
        return self.raw[node.end_lineno - 1][node.end_col_offset:].decode('utf-8')

    def text(self, node):
        return ast.get_source_segment(self.src, node)

    @staticmethod
    def first_line(stmt):
        return min([stmt.lineno] + [d.lineno for d in getattr(stmt, 'decorator_list', [])])

    # the work ------------------------------------------------------------------------------------------------------
    def run(self):
        self.body(self.tree.body, module=True, guard=True)
        return '\n'.join(l for group in self.out for l in group)

    def body(self, stmts, module, guard):
        i = 0
        while i < len(stmts):
            j = i + 1
            while j < len(stmts) and stmts[j].lineno == stmts[j - 1].end_lineno:
                j += 1
            self.group(stmts[i:j], module, guard)
            i = j

    def group(self, stmts, module, guard):
        first, last = stmts[0], stmts[-1]
        indent = self.before(first)
        tail = self.after(last).strip()
        whole_lines = not indent.strip() and (not tail.strip(';').strip() or tail.lstrip('; ').startswith('#'))
        if len(stmts) == 1 and self.compound(first):
            self.children(first, module, guard)
            if isinstance(first, ast.If) and self.raw[first.lineno - 1][first.col_offset:].startswith(b'elif'):
                return
            if module and guard and whole_lines and not indent:
                self.wrap(first)
            return
        if not whole_lines:
            return
        new = []
        for s in stmts:
            new.extend(self.simple(s, indent, module and guard))
        self.out[first.lineno - 1] = new
        for k in range(first.lineno, last.end_lineno):
            self.out[k] = []

    @staticmethod
    def compound(s):
        return isinstance(s, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.If, ast.For, ast.AsyncFor, ast.While,
                              ast.With, ast.AsyncWith, ast.Try, ast.TryStar, ast.Match))

    def children(self, s, module, guard):
        if isinstance(s, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            pass                                            # helpers format their own output
        elif isinstance(s, (ast.Try, ast.TryStar)):
            self.body(s.body, module, False)
            for h in s.handlers:
                self.body(h.body, module, False)
            self.body(s.orelse, module, False)
            self.body(s.finalbody, module, False)
        elif isinstance(s, (ast.With, ast.AsyncWith)):
            self.body(s.body, module, False)
        elif isinstance(s, ast.Match):
            for c in s.cases:
                self.body(c.body, module, guard)
        else:
            names = [n.id for n in ast.walk(s.target) if isinstance(n, ast.Name)] if isinstance(s, ast.For) else []
            self.loops.extend(names)
            self.body(s.body, module, guard)
            del self.loops[len(self.loops) - len(names):]
            self.body(s.orelse, module, guard)

    SCALARS = '(str, int, float, bytes, bool, type(None))'

    def label(self, text):
        """An expression for the label of a value: its source and, in a loop, the values of the loop variables."""
        if not self.loops:
            return repr(text + ' =>')
        shown = []
        for v in self.loops:
            shown.append('%r + (repr(%s) if type(%s) in %s or (type(%s) is tuple and all(type(_i) in %s for _i in %s)) else %s.__name__ if type(%s) is type else type(%s).__name__)'
                         % (v + '=', v, v, self.SCALARS, v, self.SCALARS, v, v, v, v))
        return '%r + %s + %r' % (text + ' [', ' + ", " + '.join(shown), '] =>')

    def handler(self, indent, what):
        return '%sexcept Exception as _pe: print(%r + type(_pe).__name__ + ": " + str(_pe) + %r)' % (indent, MARK, '> in: ' + clip(what))

    def simple(self, s, indent, guard):
        text = self.text(s)
        if isinstance(s, ast.Expr) and isinstance(s.value, ast.Call) and isinstance(s.value.func, ast.Name):
            call = s.value
            plain = not call.keywords and not any(isinstance(a, ast.Starred) for a in call.args)
            if call.func.id == 'print' and plain and call.args:
                return self.prints(call, indent, guard)
            if call.func.id == 't' and plain and len(call.args) == 1 and guard:
                a = call.args[0]
                if isinstance(a, ast.Lambda) and not (a.args.args or a.args.vararg or a.args.kwarg or a.args.kwonlyargs or a.args.posonlyargs):
                    label = clip(self.text(a.body))
                else:
                    label = clip(self.text(a)) + '()'
                return ['%stry: print(%s, end=" "); %s' % (indent, self.label(label), text), self.handler(indent, text)]
        if not guard or self.leave_alone(s, text):
            return [indent + text]
        return [indent + 'try: ' + text, self.handler(indent, text)]

    @staticmethod
    def leave_alone(s, text):
        if isinstance(s, (ast.Pass, ast.Global, ast.Nonlocal, ast.Break, ast.Continue, ast.Return)):
            return True
        if isinstance(s, ast.Expr) and isinstance(s.value, ast.Constant):
            return True                                     # docstrings and the like
        if isinstance(s, ast.ImportFrom) and s.module == '__future__':
            return True
        return bool(re.match(r'lazy\s', text))              # not allowed inside try

    def prints(self, call, indent, guard):
        new = []
        consts = []                                         # literal arguments go with the value that follows them
        def emit(stmt, what):
            if guard:
                new.append(indent + 'try: ' + stmt)
                new.append(self.handler(indent, what))
            else:
                new.append(indent + stmt)
        for a in call.args:
            seg = self.text(a)
            if isinstance(a, ast.Constant) and '\n' not in seg:
                consts.append(seg)
                continue
            val = '(' + seg + '\n)' if '\n' in seg else seg
            if len(call.args) == 1 and not self.loops:
                emit('print(%s)' % val, seg)
            else:
                emit('print(%s)' % ', '.join(consts + [self.label(clip(seg)), val]), seg)
            consts = []
        if consts:
            emit('print(%s)' % ', '.join(consts), consts[0])
        return new

    def wrap(self, s):
        for n in ast.walk(s):
            if isinstance(n, (ast.Constant, ast.JoinedStr, ast.TemplateStr)) and n.lineno != n.end_lineno:
                return                                      # indenting would change a multi-line string
            if isinstance(n, (ast.Import, ast.ImportFrom)) and getattr(n, 'is_lazy', False):
                return
        a, b = self.first_line(s) - 1, s.end_lineno - 1
        for k in range(a, b + 1):
            self.out[k] = ['    ' + l if l.strip() else l for l in self.out[k]]
        self.out[a].insert(0, 'try:')
        self.out[b].append(self.handler('', self.lines[s.lineno - 1]))


def split(src, name):
    if '_uncaught' in name or '_exit' in name or '_sysexit' in name or '# split: no' in src:
        return src
    try:
        new = Splitter(src).run()
        compile(new, name, 'exec')
    except (SyntaxError, RecursionError):
        return src
    return new


if __name__ == '__main__':
    source, destination = sys.argv[1:]
    with open(source, encoding='utf-8') as f:
        text = f.read()
    result = split(text, os.path.basename(source))
    tmp = destination + '.%d.tmp' % os.getpid()
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write(result)
    os.replace(tmp, destination)
