# Small interpreters: a Lisp, a stack machine with a compiler, Brainf***, and a regular-expression matcher.
class LispError(Exception): pass
def lex(s): return s.replace("(", " ( ").replace(")", " ) ").replace("'", " ' ").split()
def parse(tokens):
    if not tokens: raise LispError("unexpected end of input")
    t = tokens.pop(0)
    if t == "(":
        out = []
        while tokens and tokens[0] != ")": out.append(parse(tokens))
        if not tokens: raise LispError("missing )")
        tokens.pop(0); return out
    if t == ")": raise LispError("unexpected )")
    if t == "'": return ["quote", parse(tokens)]
    for conv in (int, float):
        try: return conv(t)
        except ValueError: pass
    return Sym(t)
class Sym(str):
    def __repr__(self): return str(self)
class Env(dict):
    def __init__(self, names=(), values=(), outer=None): super().__init__(zip(names, values)); self.outer = outer
    def find(self, k):
        e = self
        while e is not None:
            if k in e: return e
            e = e.outer
        raise LispError("unbound symbol " + k)
class Lambda:
    def __init__(self, params, body, env): self.params, self.body, self.env = params, body, env
    def __call__(self, *args):
        if len(args) != len(self.params): raise LispError("expected %d arguments, got %d" % (len(self.params), len(args)))
        return evaluate(self.body, Env(self.params, args, self.env))
def show(v):
    if v is True: return "#t"
    if v is False: return "#f"
    if isinstance(v, list): return "(" + " ".join(map(show, v)) + ")"
    if isinstance(v, Lambda): return "<lambda/%d>" % len(v.params)
    return str(v)
def prod(*a):
    r = 1
    for v in a: r *= v
    return r
GLOBAL = Env()
GLOBAL.update({"+": lambda *a: sum(a), "*": prod, "-": lambda a, *b: -a if not b else a - sum(b), "/": lambda a, b: a / b if a % b else a // b, "<": lambda a, b: a < b, ">": lambda a, b: a > b, "=": lambda a, b: a == b, "<=": lambda a, b: a <= b, "mod": lambda a, b: a % b, "car": lambda l: l[0], "cdr": lambda l: l[1:], "cons": lambda a, l: [a] + l, "list": lambda *a: list(a), "null?": lambda l: l == [], "length": len, "not": lambda v: v is False, "append": lambda *l: sum(l, []), "apply": lambda f, a: f(*a), "map": lambda f, l: [f(v) for v in l], "filter": lambda f, l: [v for v in l if f(v) is not False], "number?": lambda v: isinstance(v, (int, float)) and not isinstance(v, bool), "symbol?": lambda v: isinstance(v, Sym), "list?": lambda v: isinstance(v, list), "eq?": lambda a, b: a == b, "max": max, "min": min, "abs": abs})
def evaluate(x, env=GLOBAL):
    while True:
        if isinstance(x, Sym): return env.find(x)[x]
        if not isinstance(x, list): return x
        if not x: raise LispError("cannot evaluate ()")
        op, *args = x
        if op == "quote": return args[0]
        if op == "if":
            test, then, *alt = args
            x = then if evaluate(test, env) is not False else (alt[0] if alt else False); continue
        if op == "define":
            if isinstance(args[0], list): env[args[0][0]] = Lambda(args[0][1:], ["begin"] + args[1:], env); return args[0][0]
            env[args[0]] = evaluate(args[1], env); return args[0]
        if op == "set!": env.find(args[0])[args[0]] = evaluate(args[1], env); return args[0]
        if op == "lambda": return Lambda(args[0], ["begin"] + args[1:], env)
        if op == "begin":
            for e in args[:-1]: evaluate(e, env)
            x = args[-1]; continue
        if op == "let":
            env = Env([b[0] for b in args[0]], [evaluate(b[1], env) for b in args[0]], env); x = ["begin"] + args[1:]; continue
        if op == "cond":
            for test, *body in args:
                if test == "else" or evaluate(test, env) is not False: x = ["begin"] + body; break
            else: return False
            continue
        if op == "and":
            v = True
            for e in args:
                v = evaluate(e, env)
                if v is False: return False
            return v
        if op == "or":
            for e in args:
                v = evaluate(e, env)
                if v is not False: return v
            return False
        f = evaluate(op, env); vals = [evaluate(a, env) for a in args]
        if isinstance(f, Lambda):
            if len(vals) != len(f.params): raise LispError("expected %d arguments, got %d" % (len(f.params), len(vals)))
            env = Env(f.params, vals, f.env); x = f.body; continue
        if not callable(f): raise LispError("not a procedure: " + show(f))
        return f(*vals)
PROGRAM = """
(+ 1 2 (* 3 4))
(define (square x) (* x x))
(square 12)
(define (fact n) (if (<= n 1) 1 (* n (fact (- n 1)))))
(fact 20)
(define (fib n) (if (< n 2) n (+ (fib (- n 1)) (fib (- n 2)))))
(map fib '(0 1 2 3 4 5 6 7 8 9 10))
(define (loop n acc) (if (= n 0) acc (loop (- n 1) (+ acc n))))
(loop 5000 0)
(define (make-counter) (let ((n 0)) (lambda () (set! n (+ n 1)) n)))
(define c1 (make-counter))
(define c2 (make-counter))
(list (c1) (c1) (c2) (c1))
(define (range a b) (if (< a b) (cons a (range (+ a 1) b)) '()))
(filter (lambda (x) (= 0 (mod x 3))) (range 0 20))
(define (compose f g) (lambda (x) (f (g x))))
((compose square (lambda (x) (+ x 1))) 4)
(define (reverse l) (if (null? l) '() (append (reverse (cdr l)) (list (car l)))))
(reverse '(1 2 (3 4) five))
(define (qsort l) (if (null? l) '() (let ((p (car l)) (r (cdr l))) (append (qsort (filter (lambda (x) (< x p)) r)) (list p) (qsort (filter (lambda (x) (not (< x p))) r))))))
(qsort '(3 1 4 1 5 9 2 6 5 3 5))
(cond ((< 1 0) 'a) ((= 1 2) 'b) (else 'c))
(and 1 2 3)
(and 1 (< 2 1) 3)
(or (< 2 1) 'x)
(let ((x 2) (y 3)) (* x y))
(apply + '(1 2 3))
(/ 7 2)
(/ 8 2)
(if (< 1 2) 'yes)
'(quote a)
(lambda (a b) a)
(define (ackermann m n) (cond ((= m 0) (+ n 1)) ((= n 0) (ackermann (- m 1) 1)) (else (ackermann (- m 1) (ackermann m (- n 1))))))
(ackermann 2 3)
(undefined-thing)
(car '())
(1 2 3)
((lambda (x) x))
(+ 1 'a)
(
)
()
(/ 1 0)
"""
for line in PROGRAM.strip().split("\n"):
    try: print(line[:50].ljust(50), "=>", show(evaluate(parse(lex(line)))))
    except LispError as e: print(line[:50].ljust(50), "=> error:", e)
    except Exception as e: print(line[:50].ljust(50), "=>", type(e).__name__ + ":", e)
# A compiler from expressions to a stack machine.
def compile_expr(e, code=None):
    code = [] if code is None else code
    match e:
        case int() | float(): code.append(("push", e))
        case str(): code.append(("load", e))
        case ("let", name, value, body): compile_expr(value, code); code.append(("store", name)); compile_expr(body, code)
        case ("if", c, a, b):
            compile_expr(c, code); jz = len(code); code.append(None); compile_expr(a, code); jmp = len(code); code.append(None)
            code[jz] = ("jz", len(code)); compile_expr(b, code); code[jmp] = ("jmp", len(code))
        case ("while", c, body):
            top = len(code); compile_expr(c, code); jz = len(code); code.append(None); compile_expr(body, code); code.append(("pop",)); code.append(("jmp", top)); code[jz] = ("jz", len(code)); code.append(("push", 0))
        case ("seq", *es):
            for i, x in enumerate(es):
                compile_expr(x, code)
                if i < len(es) - 1: code.append(("pop",))
        case ("set", name, value): compile_expr(value, code); code.append(("dup",)); code.append(("store", name))
        case (("+" | "-" | "*" | "//" | "%" | "<" | "==") as op, a, b): compile_expr(a, code); compile_expr(b, code); code.append(("op", op))
        case _: raise SyntaxError("cannot compile %r" % (e,))
    return code
def run(code, **env):
    stack = []; pc = 0; steps = 0
    ops = {"+": lambda a, b: a + b, "-": lambda a, b: a - b, "*": lambda a, b: a * b, "//": lambda a, b: a // b, "%": lambda a, b: a % b, "<": lambda a, b: int(a < b), "==": lambda a, b: int(a == b)}
    while pc < len(code):
        ins, *arg = code[pc]; pc += 1; steps += 1
        if ins == "push": stack.append(arg[0])
        elif ins == "load": stack.append(env[arg[0]])
        elif ins == "store": env[arg[0]] = stack.pop()
        elif ins == "pop": stack.pop()
        elif ins == "dup": stack.append(stack[-1])
        elif ins == "jmp": pc = arg[0]
        elif ins == "jz":
            if not stack.pop(): pc = arg[0]
        elif ins == "op": b = stack.pop(); a = stack.pop(); stack.append(ops[arg[0]](a, b))
    return stack.pop(), steps
code = compile_expr(("+", 1, ("*", 2, 3))); print(code, run(code))
code = compile_expr(("let", "x", 5, ("if", ("<", "x", 3), ("*", "x", 2), ("-", "x", 3)))); print(code, run(code))
sum_to = ("seq", ("set", "i", 0), ("set", "s", 0), ("while", ("<", "i", "n"), ("seq", ("set", "i", ("+", "i", 1)), ("set", "s", ("+", "s", "i")))), "s"); code = compile_expr(sum_to); print(len(code), run(code, n=10), run(code, n=200))
gcd_prog = ("seq", ("while", ("<", 0, "b"), ("seq", ("set", "t", ("%", "a", "b")), ("set", "a", "b"), ("set", "b", "t"))), "a"); print(run(compile_expr(gcd_prog), a=1071, b=462))
for bad in (("?", 1, 2), ("+", 1), [1]):
    try: compile_expr(bad)
    except SyntaxError as e: print("SyntaxError:", e)
try: run(compile_expr("nope"))
except KeyError as e: print("KeyError:", e)
# Brainf***.
def bf(src, inp=""):
    jump = {}; st = []
    for i, c in enumerate(src):
        if c == "[": st.append(i)
        elif c == "]": j = st.pop(); jump[i], jump[j] = j, i
    tape = [0] * 300; p = pc = 0; out = []; inp = list(inp)
    while pc < len(src):
        c = src[pc]
        if c == ">": p += 1
        elif c == "<": p -= 1
        elif c == "+": tape[p] = (tape[p] + 1) % 256
        elif c == "-": tape[p] = (tape[p] - 1) % 256
        elif c == ".": out.append(chr(tape[p]))
        elif c == ",": tape[p] = ord(inp.pop(0)) if inp else 0
        elif c == "[" and not tape[p]: pc = jump[pc]
        elif c == "]" and tape[p]: pc = jump[pc]
        pc += 1
    return "".join(out)
print(repr(bf("++++++++[>++++[>++>+++>+++>+<<<<-]>+>+>->>+[<]<-]>>.>---.+++++++..+++.>>.<-.<.+++.------.--------.>>+.>++.")), bf(",[.,]", "echo"), bf(",>,<[->+<]>.", "\x20\x21"), bf("+++[>+++[>+++<-]<-]>>++++++."))
# A tiny regular-expression matcher (literals . * + ? ^ $ and classes).
def rx(pat, text):
    def atoms(p):
        out = []; i = 0
        while i < len(p):
            if p[i] == "[":
                j = p.index("]", i + 1); body = p[i + 1:j]; neg = body.startswith("^"); body = body[neg:]; chars = set(); k = 0
                while k < len(body):
                    if k + 2 < len(body) and body[k + 1] == "-": chars.update(chr(c) for c in range(ord(body[k]), ord(body[k + 2]) + 1)); k += 3
                    else: chars.add(body[k]); k += 1
                a = ("set", frozenset(chars), neg); i = j + 1
            elif p[i] == "\\": a = ("lit", p[i + 1]); i += 2
            elif p[i] == ".": a = ("any",); i += 1
            else: a = ("lit", p[i]); i += 1
            q = ""
            if i < len(p) and p[i] in "*+?": q = p[i]; i += 1
            out.append((a, q))
        return out
    def one(a, c): return a[0] == "any" or (a[0] == "lit" and a[1] == c) or (a[0] == "set" and (c in a[1]) != a[2])
    def here(ats, i, end):
        if not ats: return i if not end or i == len(text) else None
        (a, q), rest = ats[0], ats[1:]
        if q in ("*", "+"):
            j = i
            while j < len(text) and one(a, text[j]): j += 1
            while j >= i + (q == "+"):
                r = here(rest, j, end)
                if r is not None: return r
                j -= 1
            return None
        if q == "?":
            if i < len(text) and one(a, text[i]):
                r = here(rest, i + 1, end)
                if r is not None: return r
            return here(rest, i, end)
        return here(rest, i + 1, end) if i < len(text) and one(a, text[i]) else None
    anchored = pat.startswith("^"); end = pat.endswith("$") and not pat.endswith("\\$"); ats = atoms(pat[anchored:len(pat) - end])
    for s in range(0, 1 if anchored else len(text) + 1):
        e = here(ats, s, end)
        if e is not None: return text[s:e]
    return None
for pat, text in (("abc", "xxabcxx"), ("a.c", "abc"), ("a*", "aaab"), ("a+b", "caaab"), ("colou?r", "my color"), ("^ab", "abab"), ("^b", "ab"), ("ab$", "abab"), ("^a.*z$", "a to z"), ("[0-9]+", "tel 12345 x"), ("[^ ]+", "  word  "), ("[a-c]+[x-z]?", "--abcaz"), ("a\\.b", "a.b axb"), ("x*", "abc"), ("(", "a(b"), ("[abc", "a") , (".*", ""), ("a.*b.*c", "a1b2c3c"), ("h.llo w.rld", "hello world"), ("é+", "caféé")):
    try: print(repr(pat), repr(text), "->", repr(rx(pat, text)))
    except Exception as e: print(repr(pat), repr(text), "->", type(e).__name__ + ":", e)
