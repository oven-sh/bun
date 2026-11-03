#!/usr/bin/env python3
"""Translates a file of CPython's Lib/test to TypeScript: see README.md.

    python3 translate.py [--native-classes] [--native-async] [--inline-with] Lib/test/test_bisect.py test.test_bisect out/test_bisect.test.ts

writes the translation and, beside it, out/test_bisect.json: which test methods were translated, and why the others were not.
What cannot be translated faithfully is left out and counted. Runs under any Python that has the `ast` of the file's language.
"""

import ast
import builtins
import json
import os
import sys

# Names of Python's that JavaScript does not let a variable have, or that the translation itself uses.
RESERVED = frozenset(
    """
    arguments await break case catch class const continue debugger default delete do else enum eval export extends false
    finally for function if implements import in instanceof interface let new null package private protected public return
    static super switch this throw true try typeof undefined var void while with yield NaN Infinity
    """.split()
)

BUILTINS = frozenset(dir(builtins))

BINARY = {
    ast.Add: "add", ast.Sub: "sub", ast.Mult: "mul", ast.Div: "truediv", ast.FloorDiv: "floordiv", ast.Mod: "mod",
    ast.Pow: "pow", ast.MatMult: "matmul", ast.LShift: "lshift", ast.RShift: "rshift", ast.BitAnd: "and_",
    ast.BitOr: "or_", ast.BitXor: "xor",
}  # fmt: skip
INPLACE = {
    ast.Add: "iadd", ast.Sub: "isub", ast.Mult: "imul", ast.Div: "itruediv", ast.FloorDiv: "ifloordiv", ast.Mod: "imod",
    ast.Pow: "ipow", ast.MatMult: "imatmul", ast.LShift: "ilshift", ast.RShift: "irshift", ast.BitAnd: "iand",
    ast.BitOr: "ior", ast.BitXor: "ixor",
}  # fmt: skip
COMPARE = {ast.Eq: "eq", ast.NotEq: "ne", ast.Lt: "lt", ast.LtE: "le", ast.Gt: "gt", ast.GtE: "ge"}
UNARY = {ast.USub: "neg", ast.UAdd: "pos", ast.Invert: "invert"}

# Built-in functions whose result is a bool.
PREDICATES = frozenset("isinstance issubclass hasattr callable bool all any".split())
# What goes by the frame of its caller, which is not a frame of Python's here.
NEEDS_FRAME = frozenset("locals globals".split())
NEEDS_FRAME_WITHOUT_ARGUMENTS = frozenset("vars dir".split())
NEEDS_FRAME_ATTRIBUTES = frozenset("_getframe currentframe _getframemodulename".split())

MAX_SAFE = 2**53 - 1

if hasattr(sys, "set_int_max_str_digits"):
    sys.set_int_max_str_digits(0)


class NotNative(Exception):
    """The class statement has something in it that `class extends` cannot say."""


class Skip(Exception):
    """The construct is not translated. The message is the reason, one of a few, for the count."""


class Scope:
    def __init__(self, kind, parent, name=""):
        self.kind = kind  # module, function, class, comprehension
        self.parent = parent
        self.name = name
        self.bound = set()
        self.globals = set()
        self.nonlocals = set()
        self.declared = []  # What the translation adds to the variables of the function of JavaScript.
        self.is_async = False
        self.is_generator = False
        self.namespace = None  # Of a class: the variable that has the namespace, and the one that has the class.
        self.class_variable = None
        self.cell = None  # The variable that has the cell for __class__.
        self.needs_cell = False
        self.is_native = False  # It is a class of JavaScript's.
        self.annotations = []
        self.is_test_class = False
        self.first_parameter = None
        self.rebinds_first_parameter = False
        self.is_static = False  # A method that may be called with something else than an instance first.
        self.handlers = []  # The variables of the `catch` clauses around.
        self.loops = []  # For each loop around: the label that `break` goes to, or None.
        if kind == "class":
            self.private = name
            self.qualname = parent.prefix + name
            self.prefix = self.qualname + "."
        elif kind == "function":
            self.private = parent.private
            self.qualname = parent.prefix + name
            self.prefix = self.qualname + ".<locals>."
        else:
            self.private = parent.private if parent else None
            self.qualname = parent.qualname if parent else ""
            self.prefix = parent.prefix if parent else ""

    def declare(self, name):
        if name not in self.declared:
            self.declared.append(name)
        return name


class Binder(ast.NodeVisitor):
    """Finds the names that a block binds."""

    def __init__(self, scope, mangle):
        self.scope = scope
        self.mangle = mangle

    def bind(self, name):
        if name == "__class__":
            raise Skip("__class__ as a variable")
        self.scope.bound.add(self.mangle(name))

    def visit_Name(self, node):
        if not isinstance(node.ctx, ast.Load):
            self.bind(node.id)

    def function(self, node):
        self.bind(node.name)
        for decorator in node.decorator_list:
            self.visit(decorator)
        self.visit_arguments(node.args)

    visit_FunctionDef = visit_AsyncFunctionDef = function

    def visit_arguments(self, node):
        for default in node.defaults + node.kw_defaults:
            if default is not None:
                self.visit(default)

    def visit_Lambda(self, node):
        self.visit_arguments(node.args)

    def visit_ClassDef(self, node):
        self.bind(node.name)
        for part in node.decorator_list + node.bases + node.keywords:
            self.visit(part)

    def comprehension(self, node):
        self.visit(node.generators[0].iter)
        # x := value in a comprehension binds x in the function around it.
        for inner in ast.walk(node):
            if isinstance(inner, ast.NamedExpr):
                self.bind(inner.target.id)

    visit_ListComp = visit_SetComp = visit_DictComp = visit_GeneratorExp = comprehension

    def visit_Import(self, node):
        for alias in node.names:
            self.bind(alias.asname or alias.name.partition(".")[0])

    def visit_ImportFrom(self, node):
        for alias in node.names:
            if alias.name != "*":
                self.bind(alias.asname or alias.name)

    def visit_Global(self, node):
        if BUILTINS.intersection(node.names):
            raise Skip("a global variable in the place of a built-in")
        self.scope.globals.update(map(self.mangle, node.names))

    def visit_Nonlocal(self, node):
        if "__class__" in node.names:
            raise Skip("__class__ as a variable")
        self.scope.nonlocals.update(map(self.mangle, node.names))

    def visit_ExceptHandler(self, node):
        if node.name:
            self.bind(node.name)
        self.generic_visit(node)

    def visit_MatchAs(self, node):
        if node.name:
            self.bind(node.name)
        self.generic_visit(node)

    def visit_MatchStar(self, node):
        if node.name:
            self.bind(node.name)

    def visit_MatchMapping(self, node):
        if node.rest:
            self.bind(node.rest)
        self.generic_visit(node)


def own_nodes(body):
    """The nodes of a block, not those of the functions and classes defined in it."""
    stack = list(body)
    while stack:
        node = stack.pop()
        yield node
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda, ast.ClassDef)):
            continue
        stack.extend(ast.iter_child_nodes(node))


def js_string(text):
    return json.dumps(text)


def js_template_text(text):
    out = []
    for character in text:
        code = ord(character)
        if character in "\\`$":
            out.append("\\" + character)
        elif character == "\n":
            out.append("\\n")
        elif code < 0x20 or 0x7F <= code <= 0xFFFF:
            out.append(f"\\u{code:04x}")
        elif code > 0xFFFF:
            out.append(f"\\u{{{code:x}}}")
        else:
            out.append(character)
    return "".join(out)


def js_key(name):
    return name if name.isascii() and name.isidentifier() else js_string(name)


def indent(lines):
    return ["  " + line if line else line for line in lines]


def wrap(prefix, lines, suffix):
    """The lines of an expression, with text before and after."""
    lines = list(lines)
    lines[0] = prefix + lines[0]
    lines[-1] += suffix
    return lines


def is_test_name(name):
    return name.startswith("test")


class Translator:
    def __init__(self, source, module_name, is_package=False, libraries=frozenset(), is_library=False, native_async=False, native_classes=False, inline_with=False):
        self.tree = ast.parse(source)
        # A class statement is `class extends` where that is the same thing.
        self.native_classes = native_classes
        self.native_class_names = set()
        # `with` is always written out, and never a call of `with()` of bun:python.
        self.inline_with = inline_with
        # `async def` is an async function of JavaScript. That is not the same thing: it starts when it is called, it gives a
        # promise, which no loop but the host's can run, and nothing can be sent to it or thrown into it. Otherwise it is a
        # coroutine of Python's whose body is a generator of JavaScript's, and `await` is `yield*`.
        self.native_async = native_async
        uses_async = any(
            isinstance(node, (ast.AsyncFunctionDef, ast.Await))
            or (isinstance(node, ast.Import) and any(alias.name.split(".")[0] == "asyncio" for alias in node.names))
            or (isinstance(node, ast.ImportFrom) and (node.module or "").split(".")[0] == "asyncio")
            for node in ast.walk(self.tree)
        )
        # To call a coroutine function of Python's from JavaScript gives a promise too. In a file that has to do with
        # coroutines the calls are made by Python, which hands over what they return as it is.
        self.raw_calls = uses_async and not native_async
        self.module_name = module_name
        self.is_package = is_package
        # The modules of Lib/test that are no tests themselves and are translated too: who imports one gets the translation.
        self.libraries = libraries
        self.is_library = is_library
        self.dependencies = []
        self.package = module_name if is_package else module_name.rpartition(".")[0]
        self.counter = 0
        self.module = Scope("module", None)
        self.has_star_import = False
        self.future_annotations = False
        self.manifest = {}  # "Class.test_name": "ok" or the reason
        self.left_out = {}  # Helpers: "name": reason
        self.skipped_classes = {}
        self.workarounds = {}
        self.native_count = 0
        # The names that some call in the file passes by keyword: a function with such a parameter has to look for them.
        self.keyword_names = {
            keyword.arg for node in ast.walk(self.tree) if isinstance(node, ast.Call) for keyword in node.keywords
        }
        self.has_double_star_call = None in self.keyword_names
        self.test_classes = self.find_test_classes()

    # ---- Helpers ----

    def uid(self):
        self.counter += 1
        return self.counter

    def temp(self, scope):
        return self.js_function(scope).declare(f"${self.uid()}")

    def js_function(self, scope):
        return scope

    def mangler(self, scope):
        private = scope.private

        def mangle(name):
            if private and name.startswith("__") and not name.endswith("__") and "." not in name:
                stripped = private.lstrip("_")
                if stripped:
                    return f"_{stripped}{name}"
            return name

        return mangle

    def find_test_classes(self):
        """The names of the classes at the top of the file whose instances are test cases, as far as can be told."""
        found = set()
        classes = [node for node in ast.walk(self.tree) if isinstance(node, ast.ClassDef)]
        changed = True
        while changed:
            changed = False
            for node in classes:
                if node.name in found:
                    continue
                is_one = any(
                    isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)) and is_test_name(item.name)
                    for item in node.body
                )
                for base in node.bases:
                    if isinstance(base, ast.Attribute) and base.attr.endswith("TestCase"):
                        is_one = True
                    elif isinstance(base, ast.Name) and (base.id.endswith("TestCase") or base.id in found):
                        is_one = True
                if is_one:
                    found.add(node.name)
                    changed = True
        return found

    # ---- Names ----

    @staticmethod
    def js_name(name):
        if name in RESERVED:
            return name + "$"
        if not name.isascii():
            return "".join(c if c.isascii() else f"$u{ord(c):x}" for c in name)
        return name

    def resolve(self, name, scope):
        """("class", scope), ("variable",), ("builtin",), ("star",) or ("unknown",)"""
        if scope.kind == "class" and name in scope.bound and name not in scope.globals and name not in scope.nonlocals:
            return ("class", scope)
        if name in scope.globals:
            return ("variable",)
        current = scope if scope.kind != "class" else scope.parent
        while current is not None:
            if current.kind != "class":
                if name in current.globals:
                    break
                if name in current.bound:
                    return ("variable",)
            current = current.parent
        if name in self.module.bound:
            return ("variable",)
        if self.has_star_import:
            return ("star",)
        if name in BUILTINS:
            return ("builtin",)
        return ("unknown",)

    def is_builtin(self, node, scope, names=None):
        return (
            isinstance(node, ast.Name)
            and (names is None or node.id in names)
            and node.id in BUILTINS
            # What `import *` brings is taken not to hide a built-in.
            and self.resolve(node.id, scope)[0] in ("builtin", "star")
        )

    def load_outside_class(self, name, scope):
        kind = self.resolve(name, scope)[0]
        if kind == "variable":
            return self.js_name(name)
        if kind == "star":
            return f"$.star($stars, {js_string(name)})"
        if kind == "builtin":
            return f"$b.{name}"
        return f"$.unbound({js_string(name)})"

    def load_name(self, name, scope):
        if name == "__name__" and name not in self.module.bound:
            return "$n"
        if name == "__file__" and name not in self.module.bound:
            return "$m.__file__"
        if name in ("__spec__", "__loader__", "__package__", "__path__") and name not in self.module.bound:
            return f"$m.{name}"
        if name == "__debug__":
            return "true"
        if name == "__class__":
            return self.class_cell(scope)
        if name in ("__builtins__", "__dict__", "__annotations__", "__doc__") and self.resolve(name, scope)[0] != "class":
            if name not in self.module.bound:
                raise Skip("the namespace of the module")
        name = self.mangler(scope)(name)
        resolved = self.resolve(name, scope)
        if resolved[0] == "class":
            outside = self.load_outside_class(name, scope.parent)
            return f"$.lookup({scope.namespace}, {js_string(name)}, () => {outside})"
        return self.load_outside_class(name, scope)

    def class_cell(self, scope):
        """The variable that has the class whose method this is."""
        current = scope
        while current is not None and current.kind != "class":
            current = current.parent
        if current is None or scope.kind == "class":
            raise Skip("super() or __class__ outside a method")
        if current.is_native:
            return current.class_variable
        current.needs_cell = True
        return f"{current.cell}.cell_contents"

    def store_name(self, name, value, scope):
        """A statement."""
        name = self.mangler(scope)(name)
        if self.resolve(name, scope)[0] == "class":
            return f"$.setitem({scope.namespace}, {js_string(name)}, {value});"
        if name in scope.globals:
            # The module object has the names of the file as they are when it has been loaded, and what functions bind later.
            return f"{self.js_name(name)} = $m.{name} = {value};"
        return f"{self.js_name(name)} = {value};"

    # ---- Expressions: (text, whether it can be an operand as it is) ----

    def x(self, node, scope):
        """The expression, where an argument can be."""
        return self.expression(node, scope)[0]

    def a(self, node, scope):
        """The expression, where an operand or a callee can be."""
        text, is_atomic = self.expression(node, scope)
        return text if is_atomic else f"({text})"

    def expression(self, node, scope):
        method = getattr(self, "e_" + type(node).__name__, None)
        if method is None:
            raise Skip(f"syntax: {type(node).__name__}")
        return method(node, scope)

    def e_Constant(self, node, scope):
        return self.constant(node.value), True

    def constant(self, value):
        if value is None:
            return "undefined"
        if value is True:
            return "true"
        if value is False:
            return "false"
        if isinstance(value, str):
            return js_string(value)
        if isinstance(value, bytes):
            return f"$.b({js_string(value.decode('latin-1'))})"
        if isinstance(value, int):
            return str(value) if -MAX_SAFE <= value <= MAX_SAFE else f"{value}n"
        if isinstance(value, float):
            if value != value:
                return "NaN"
            if value in (float("inf"), float("-inf")):
                return "Infinity" if value > 0 else "-Infinity"
            if value == int(value):
                if abs(value) <= MAX_SAFE:
                    return f"$.float({'-0' if str(value) == '-0.0' else int(value)})"
            return repr(value)
        if isinstance(value, complex):
            return f"$b.complex({self.constant(value.real)}, {self.constant(value.imag)})"
        if value is Ellipsis:
            return "$b.Ellipsis"
        raise Skip(f"constant: {type(value).__name__}")

    def constant_number(self, node):
        """The int or float that the expression is whatever happens, or None."""
        if isinstance(node, ast.Constant):
            return node.value if type(node.value) in (int, float) else None
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, (ast.USub, ast.UAdd, ast.Invert)):
            value = self.constant_number(node.operand)
            if value is None or (isinstance(node.op, ast.Invert) and type(value) is not int):
                return None
            return -value if isinstance(node.op, ast.USub) else +value if isinstance(node.op, ast.UAdd) else ~value
        if isinstance(node, ast.BinOp):
            left = self.constant_number(node.left)
            right = self.constant_number(node.right)
            if type(left) is not int or type(right) is not int:
                return None
            op = type(node.op)
            try:
                if op is ast.Add:
                    return left + right
                if op is ast.Sub:
                    return left - right
                if op is ast.Mult and left.bit_length() + right.bit_length() < 4000:
                    return left * right
                if op is ast.FloorDiv:
                    return left // right
                if op is ast.Mod:
                    return left % right
                if op is ast.Pow and 0 <= right and left.bit_length() * right < 4000:
                    return left**right
                if op is ast.LShift and 0 <= right < 4000:
                    return left << right
                if op is ast.RShift and 0 <= right:
                    return left >> right
                if op is ast.BitAnd:
                    return left & right
                if op is ast.BitOr:
                    return left | right
                if op is ast.BitXor:
                    return left ^ right
            except (ZeroDivisionError, OverflowError):
                pass
        return None

    def e_Name(self, node, scope):
        return self.load_name(node.id, scope), True

    def is_test_case(self, node, scope):
        """Whether the expression is `self` in a method of a test case."""
        if not isinstance(node, ast.Name):
            return False
        current = scope
        while current is not None:
            if current.kind != "class" and node.id in current.bound:
                return (
                    current.kind == "function"
                    and current.first_parameter == node.id == "self"
                    and not current.rebinds_first_parameter
                    and not current.is_static
                    and current.parent.kind == "class"
                    and current.parent.is_test_class
                )
            current = current.parent
        return False

    def e_Attribute(self, node, scope):
        name = self.mangler(scope)(node.attr)
        if name in NEEDS_FRAME_ATTRIBUTES:
            raise Skip("frames")
        if self.is_test_case(node.value, scope):
            return f"{self.js_name(node.value.id)}.{name}", True
        return f"$.attr({self.x(node.value, scope)}, {js_string(name)})", True

    def subscript_key(self, node, scope):
        if isinstance(node, ast.Slice):
            parts = [self.x(part, scope) if part is not None else "undefined" for part in (node.lower, node.upper, node.step)]
            return f"$.slice({', '.join(parts)})"
        if isinstance(node, ast.Tuple) and any(isinstance(item, (ast.Slice, ast.Starred)) for item in node.elts):
            return f"$.t({', '.join(self.subscript_key(item, scope) if isinstance(item, ast.Slice) else self.element(item, scope) for item in node.elts)})"
        return self.x(node, scope)

    def e_Subscript(self, node, scope):
        return f"$.getitem({self.x(node.value, scope)}, {self.subscript_key(node.slice, scope)})", True

    def e_Slice(self, node, scope):
        return self.subscript_key(node, scope), True

    def element(self, node, scope):
        if isinstance(node, ast.Starred):
            return f"...$.spread({self.x(node.value, scope)})"
        return self.x(node, scope)

    def elements(self, nodes, scope):
        return ", ".join(self.element(node, scope) for node in nodes)

    def e_List(self, node, scope):
        return f"[{self.elements(node.elts, scope)}]", True

    def e_Tuple(self, node, scope):
        return f"$.t({self.elements(node.elts, scope)})", True

    def e_Set(self, node, scope):
        return f"$.s({self.elements(node.elts, scope)})", True

    def e_Dict(self, node, scope):
        parts = []
        for key, value in zip(node.keys, node.values):
            if key is None:
                parts.append(f"[{self.x(value, scope)}]")
            else:
                parts.append(f"[{self.x(key, scope)}, {self.x(value, scope)}]")
        return f"$.d({', '.join(parts)})", True

    def e_Starred(self, node, scope):
        raise Skip("syntax: Starred")

    def e_UnaryOp(self, node, scope):
        if isinstance(node.op, ast.Not):
            return f"!{self.condition(node.operand, scope, True)}", False
        value = self.constant_number(node)
        if value is not None:
            return self.constant(value), True
        return f"$.{UNARY[type(node.op)]}({self.x(node.operand, scope)})", True

    def e_BinOp(self, node, scope):
        value = self.constant_number(node)
        if value is not None:
            return self.constant(value), True
        return f"$.{BINARY[type(node.op)]}({self.x(node.left, scope)}, {self.x(node.right, scope)})", True

    def is_boolean(self, node, scope):
        """Whether the value of the expression is True or False whatever happens."""
        if isinstance(node, ast.Constant):
            return isinstance(node.value, bool)
        if isinstance(node, ast.UnaryOp):
            return isinstance(node.op, ast.Not)
        if isinstance(node, ast.BoolOp):
            return all(self.is_boolean(value, scope) for value in node.values)
        if isinstance(node, ast.Compare):
            return all(isinstance(op, (ast.Is, ast.IsNot, ast.In, ast.NotIn)) for op in node.ops)
        if isinstance(node, ast.Call):
            return self.is_builtin(node.func, scope, PREDICATES)
        return False

    def condition(self, node, scope, atomic=False):
        """The truth of the expression, as a boolean of JavaScript."""
        if isinstance(node, ast.BoolOp):
            operator = " && " if isinstance(node.op, ast.And) else " || "
            text = operator.join(self.condition(value, scope, True) for value in node.values)
            return f"({text})" if atomic else text
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.Not):
            return f"!{self.condition(node.operand, scope, True)}"
        if self.is_boolean(node, scope):
            return self.a(node, scope) if atomic else self.x(node, scope)
        return f"$.bool({self.x(node, scope)})"

    @staticmethod
    def is_repeatable(node):
        """To evaluate it twice is to evaluate it once."""
        return isinstance(node, (ast.Name, ast.Constant))

    def e_BoolOp(self, node, scope):
        if self.is_boolean(node, scope):
            return self.condition(node, scope), False
        is_and = isinstance(node.op, ast.And)
        text = self.x(node.values[-1], scope)
        is_last = True
        for value in reversed(node.values[:-1]):
            if self.is_repeatable(value):
                first = again = self.x(value, scope)
            else:
                again = self.temp(scope)
                first = f"{again} = {self.x(value, scope)}"
            rest = text if is_last else f"({text})"
            text = f"$.bool({first}) ? {rest} : {again}" if is_and else f"$.bool({first}) ? {again} : {rest}"
            is_last = False
        return text, False

    def compare(self, op, left, right):
        """(text, is atomic), for operands that are text."""
        kind = type(op)
        if kind in COMPARE:
            return f"$.{COMPARE[kind]}({left}, {right})", True
        if kind in (ast.Is, ast.IsNot):
            sign = "===" if kind is ast.Is else "!=="
            if right in ("undefined", "true", "false") or left in ("undefined", "true", "false"):
                return f"{left} {sign} {right}", False
            return (f"$.is({left}, {right})", True) if kind is ast.Is else (f"!$.is({left}, {right})", False)
        if kind is ast.In:
            return f"$.in_({left}, {right})", True
        return f"!$.in_({left}, {right})", False

    def e_Compare(self, node, scope):
        if len(node.ops) == 1:
            # `===` takes operands; the functions take arguments.
            needs_operands = isinstance(node.ops[0], (ast.Is, ast.IsNot))
            get = self.a if needs_operands else self.x
            return self.compare(node.ops[0], get(node.left, scope), get(node.comparators[0], scope))
        # a < b < c: b is evaluated once, and c only if a < b. The value is that of the first comparison that is false.
        left = self.a(node.left, scope)
        parts = []
        for index, (op, comparator) in enumerate(zip(node.ops, node.comparators)):
            is_last = index == len(node.ops) - 1
            if is_last or self.is_repeatable(comparator):
                first = again = self.a(comparator, scope)
            else:
                again = self.temp(scope)
                first = f"({again} = {self.x(comparator, scope)})"
            parts.append(self.compare(op, left, first))
            left = again
        text, is_atomic = parts[-1]
        for part, part_is_atomic in reversed(parts[:-1]):
            result = self.temp(scope)
            text = f"$.bool({result} = {part}) ? {text if is_atomic else f'({text})'} : {result}"
            is_atomic = False
        return text, False

    def e_IfExp(self, node, scope):
        return f"{self.condition(node.test, scope, True)} ? {self.a(node.body, scope)} : {self.a(node.orelse, scope)}", False

    def e_NamedExpr(self, node, scope):
        target = scope
        while target.kind == "comprehension":
            target = target.parent
        if target.kind == "class":
            raise Skip(":= in the body of a class")
        return f"{self.js_name(self.mangler(scope)(node.target.id))} = {self.x(node.value, scope)}", False

    def e_Await(self, node, scope):
        if not self.in_async(scope):
            raise Skip("await outside an async function")
        return self.wait(self.expression(node.value, scope)), False

    def wait(self, expression):
        """`await expression`; the expression is (text, is atomic), or text that is atomic."""
        text, is_atomic = expression if isinstance(expression, tuple) else (expression, True)
        if self.native_async:
            return f"await {text if is_atomic else f'({text})'}"
        return f"yield* $.await_({text})"

    def in_async(self, scope):
        while scope.kind == "comprehension" and not scope.is_generator:
            scope = scope.parent
        return scope.is_async

    def e_Yield(self, node, scope):
        if scope.kind != "function":
            raise Skip("yield outside a function")
        if scope.is_async and not self.native_async:
            return f"yield $.yielded({self.x(node.value, scope) if node.value is not None else ''})", False
        return ("yield " + self.a(node.value, scope) if node.value is not None else "yield"), False

    def e_YieldFrom(self, node, scope):
        if scope.kind != "function":
            raise Skip("yield outside a function")
        return f"yield* $.delegate({self.x(node.value, scope)})", False

    def e_JoinedStr(self, node, scope):
        parts = []
        for value in node.values:
            if isinstance(value, ast.Constant):
                parts.append(js_template_text(value.value))
            else:
                parts.append("${" + self.formatted(value, scope) + "}")
        return "`" + "".join(parts) + "`", True

    def formatted(self, node, scope):
        text = self.x(node.value, scope)
        if node.conversion != -1:
            text = f"$b.{ {115: 'str', 114: 'repr', 97: 'ascii'}[node.conversion] }({text})"
        if node.format_spec is not None:
            return f"$b.format({text}, {self.x(node.format_spec, scope)})"
        return text if node.conversion != -1 else f"$b.format({text})"

    def e_FormattedValue(self, node, scope):
        return self.formatted(node, scope), True

    # ---- Calls ----

    def keyword_groups(self, node, scope):
        """The keyword arguments, as objects (name=value) and mappings (**mapping), in order."""
        groups = []
        named = []
        for keyword in node.keywords:
            if keyword.arg is None:
                if named:
                    groups.append("{ " + ", ".join(named) + " }")
                    named = []
                groups.append(self.x(keyword.value, scope))
            else:
                named.append(f"{js_key(keyword.arg)}: {self.x(keyword.value, scope)}")
        if named:
            groups.append("{ " + ", ".join(named) + " }")
        return groups

    def arguments(self, node, scope):
        parts = [self.element(argument, scope) for argument in node.args]
        if node.keywords:
            parts.append(f"$.kw({', '.join(self.keyword_groups(node, scope))})")
        return ", ".join(parts)

    def e_Call(self, node, scope):
        function = node.func
        if self.is_builtin(function, scope):
            name = function.id
            if name == "super" and not node.args and not node.keywords:
                method = scope
                while method.kind == "comprehension":
                    method = method.parent
                if method.kind != "function" or method.first_parameter is None:
                    raise Skip("super() or __class__ outside a method")
                return f"$b.super({self.class_cell(scope)}, {self.js_name(method.first_parameter)})", True
            if name in NEEDS_FRAME or (name in NEEDS_FRAME_WITHOUT_ARGUMENTS and not node.args):
                raise Skip("frames")
            if name in ("eval", "exec") and len(node.args) + len(node.keywords) < 2:
                raise Skip("frames")
        if any(keyword.arg is None for keyword in node.keywords):
            # What the keys of a mapping may be, and what happens if they are not, is for Python to say.
            groups = ", ".join(self.keyword_groups(node, scope))
            return f"$.call({self.x(function, scope)}, [{self.elements(node.args, scope)}], {groups})", True
        if self.raw_calls and not self.is_builtin(function, scope) and not (isinstance(function, ast.Attribute) and self.is_test_case(function.value, scope)):
            arguments = self.arguments(node, scope)
            return f"$raw({self.x(function, scope)}{', ' if arguments else ''}{arguments})", True
        return f"{self.a(function, scope)}({self.arguments(node, scope)})", True

    # ---- Functions ----

    def e_Lambda(self, node, scope):
        body = [ast.copy_location(ast.Return(node.body), node.body)]
        lines = self.function(node.args, body, "<lambda>", scope, is_lambda=True)
        text = " ".join(line.strip() for line in lines)
        if scope.kind == "class":
            return f"$.def({text}, \"<lambda>\", {js_string(scope.prefix + '<lambda>')}, $n)", True
        return text, text.startswith("$.")

    def function(self, arguments, body, name, scope, is_async=False, is_lambda=False, is_static=False, method=None, is_decorated=False):
        """The lines of an expression: the function. With `method`, what stands before the name in a class of JavaScript's
        ("", "static ", "get "...): the lines of a method, whose first parameter is `this` unless it is "static" for a staticmethod."""
        inner = Scope("function", scope, name)
        inner.is_async = is_async
        inner.is_static = is_static or is_lambda
        mangle = self.mangler(inner)
        positional = [mangle(a.arg) for a in arguments.posonlyargs + arguments.args]
        keyword_only = [mangle(a.arg) for a in arguments.kwonlyargs]
        parameters = list(positional)
        if arguments.vararg:
            parameters.append(mangle(arguments.vararg.arg))
        parameters += keyword_only
        if arguments.kwarg:
            parameters.append(mangle(arguments.kwarg.arg))
        binder = Binder(inner, mangle)
        for statement in body:
            binder.visit(statement)
        inner.first_parameter = positional[0] if positional else None
        inner.rebinds_first_parameter = inner.first_parameter in inner.bound
        assigned = inner.bound - inner.globals - inner.nonlocals - set(parameters)
        inner.bound = (inner.bound | set(parameters)) - inner.globals - inner.nonlocals
        self.module.bound |= inner.globals
        inner.is_generator = any(isinstance(node, (ast.Yield, ast.YieldFrom)) for node in own_nodes(body))
        if inner.is_generator and is_lambda:
            raise Skip("yield in a lambda")

        statements = self.block(body, inner)
        variables = sorted(self.js_name(n) for n in assigned) + inner.declared
        if variables:
            statements.insert(0, f"let {', '.join(variables)};")

        is_simple = (
            not arguments.vararg
            and not arguments.kwarg
            and not keyword_only
            and all(isinstance(d, ast.Constant) and d.value is None for d in arguments.defaults)
            and not self.has_double_star_call
            and not (is_decorated and len(positional) > 1)
            and not (set(positional[len(arguments.posonlyargs) :]) & self.keyword_names)
        )
        if method is not None:
            if not is_simple or is_async:
                raise NotNative
            prefix, takes_this = method
            if takes_this:
                if not positional:
                    raise NotNative
                statements.insert(0, f"{'let' if inner.rebinds_first_parameter else 'const'} {self.js_name(positional[0])} = this;")
                parameters = parameters[1:]
            star = "*" if inner.is_generator else ""
            return [f"{prefix}{star}{js_key(name)}({', '.join(map(self.js_name, parameters))}) {{", *indent(statements), "}"]
        head = f"({', '.join(map(self.js_name, parameters))}) =>"
        if inner.is_generator or (is_async and not self.native_async):
            kind = "async function*" if is_async and self.native_async else "function*"
            lines = [f"{head} ({kind} () {{", *indent(statements), "})()"]
        elif is_lambda and len(statements) == 1 and statements[0].startswith("return "):
            value = statements[0][len("return ") : -1]
            lines = [f"{head} {f'({value})' if value.startswith('{') else value}"]
        else:
            lines = [f"{'async ' if is_async else ''}{head} {{", *indent(statements), "}"]
        if is_simple:
            return lines

        signature = [f"name: {js_string(name)}", f"pos: [{', '.join(map(js_string, positional))}]"]
        if arguments.posonlyargs:
            signature.append(f"only: {len(arguments.posonlyargs)}")
        if arguments.defaults:
            signature.append(f"defaults: [{', '.join(self.x(d, scope) for d in arguments.defaults)}]")
        if arguments.vararg:
            signature.append("rest: true")
        if keyword_only:
            signature.append(f"kwonly: [{', '.join(map(js_string, keyword_only))}]")
            defaults = [
                f"{js_key(n)}: {self.x(d, scope)}" for n, d in zip(keyword_only, arguments.kw_defaults) if d is not None
            ]
            if defaults:
                signature.append("kwdefaults: { " + ", ".join(defaults) + " }")
        if arguments.kwarg:
            signature.append("kwrest: true")
        return wrap("$.fn({ " + ", ".join(signature) + " }, ", lines, ")")

    @staticmethod
    def docstring(body):
        if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) and isinstance(body[0].value.value, str):
            return body[0].value.value
        return None

    def s_FunctionDef(self, node, scope, is_async=False):
        if getattr(node, "type_params", None):
            raise Skip("type parameters")
        decorators = [self.a(decorator, scope) for decorator in node.decorator_list]
        doc = self.docstring(node.body)
        body = node.body[1:] if doc is not None else node.body
        lines = self.function(
            node.args, body, node.name, scope, is_async,
            is_static=self.has_decorator(node, ("staticmethod", "classmethod")),
            # Who knows how a decorator calls it.
            is_decorated=any(not self.is_builtin(d, scope, ("staticmethod", "classmethod", "property")) for d in node.decorator_list),
        )  # fmt: skip
        annotations = self.function_annotations(node, scope)
        is_test = scope.kind == "class" and scope.is_test_class
        # functools.wraps() needs the __dict__ of the function, which one of JavaScript's has not.
        needs_dict = self.has_decorator(node, ("wraps",))
        if needs_dict:
            self.workarounds["functools.wraps"] = self.workarounds.get("functools.wraps", 0) + 1
        if scope.kind == "class" or needs_dict or (is_async and not self.native_async):
            suffix = f", {js_string(node.name)}, {js_string(scope.prefix + node.name)}, $n"
            if doc is not None and not is_test:
                suffix += f", {js_string(doc)}"
            if not is_async:
                maker = "$.def("
            elif self.native_async:
                maker = "$.def(" if self.last_function_is_generator(node) else "$.defAsync("
            else:
                maker = "$.asyncGenerator(" if self.last_function_is_generator(node) else "$.coroutine("
            lines = wrap(maker, lines, suffix + ")")
        elif doc is not None or decorators:
            suffix = f", {js_string(node.name)}, {js_string(scope.prefix + node.name)}, $n"
            lines = wrap("$.named(", lines, suffix + (f", {js_string(doc)})" if doc is not None else ")"))
        if annotations:
            lines = wrap("$.annotated(", lines, f", {annotations})")
        for decorator in reversed(decorators):
            lines = wrap(decorator + "(", lines, ")")
        name = self.mangler(scope)(node.name)
        if self.resolve(name, scope)[0] == "class":
            return wrap(f"$.setitem({scope.namespace}, {js_string(name)}, ", lines, ");")
        return wrap(f"{self.js_name(name)} = ", lines, ";")

    def annotation(self, node, scope):
        return js_string(ast.unparse(node)) if self.future_annotations else self.x(node, scope)

    def function_annotations(self, node, scope):
        """The dict of the annotations of the function, which is made when somebody asks. None: it has none."""
        arguments = node.args
        mangle = self.mangler(scope)
        every = arguments.posonlyargs + arguments.args + ([arguments.vararg] if arguments.vararg else []) + arguments.kwonlyargs + ([arguments.kwarg] if arguments.kwarg else [])
        items = [(mangle(a.arg), a.annotation) for a in every if a.annotation is not None]
        if node.returns is not None:
            items.append(("return", node.returns))
        if not items:
            return None
        try:
            return "[" + ", ".join(self.annotation_entry(name, value, scope) for name, value in items) + "]"
        except Skip:
            return None

    def annotation_entry(self, name, node, scope):
        """[the name, a function that evaluates the annotation, its source]"""
        if self.future_annotations:
            return f"[{js_string(name)}, () => {js_string(ast.unparse(node))}, {js_string(repr(ast.unparse(node)))}]"
        return f"[{js_string(name)}, () => {self.a(node, scope)}, {js_string(ast.unparse(node))}]"

    @staticmethod
    def has_decorator(node, names):
        return any(
            isinstance(part, (ast.Name, ast.Attribute)) and (part.id if isinstance(part, ast.Name) else part.attr) in names
            for decorator in node.decorator_list
            for part in ast.walk(decorator)
        )

    @staticmethod
    def last_function_is_generator(node):
        return any(isinstance(inner, (ast.Yield, ast.YieldFrom)) for inner in own_nodes(node.body))

    def s_AsyncFunctionDef(self, node, scope):
        return self.s_FunctionDef(node, scope, True)

    # ---- Comprehensions ----

    def comprehension(self, node, scope, kind):
        inner = Scope("comprehension", scope)
        mangle = self.mangler(scope)
        for generator in node.generators:
            for target in ast.walk(generator.target):
                if isinstance(target, ast.Name):
                    inner.bound.add(mangle(target.id))
        has_await = any(g.is_async for g in node.generators) or any(
            isinstance(n, ast.Await)
            for n in own_nodes([node.elt] if kind != "dict" else [node.key, node.value])
        ) or any(isinstance(n, ast.Await) for g in node.generators for n in own_nodes(g.ifs + ([] if g is node.generators[0] else [g.iter])))
        inner.is_generator = kind == "generator"
        inner.is_async = has_await
        if has_await and kind != "generator" and not self.in_async(scope):
            raise Skip("await outside an async function")
        first = self.x(node.generators[0].iter, scope)

        if kind == "dict":
            item = f"$r.push([{self.x(node.key, inner)}, {self.x(node.value, inner)}]);"
        elif kind == "generator" and has_await and not self.native_async:
            item = f"yield $.yielded({self.x(node.elt, inner)});"
        elif kind == "generator":
            item = f"yield {self.a(node.elt, inner)};"
        else:
            item = f"$r.push({self.x(node.elt, inner)});"
        text = item
        for index, generator in reversed(list(enumerate(node.generators))):
            for test in reversed(generator.ifs):
                text = f"if ({self.condition(test, inner)}) {{ {text} }}"
            iterable = "$0" if index == 0 else self.x(generator.iter, inner)
            head, prelude = self.loop_target(generator.target, inner)
            if generator.is_async and self.native_async:
                text = f"for await ({head} of $.aiter({iterable})) {{ {' '.join(prelude + [text])} }}"
            elif generator.is_async:
                before, loop_head, loop_prelude = self.async_loop(generator.target, iterable, inner)
                text = f"{before} {loop_head} {{ {' '.join(loop_prelude + [text])} }}"
            else:
                text = f"for ({head} of $.iter({iterable})) {{ {' '.join(prelude + [text])} }}"
        variables = sorted(map(self.js_name, inner.bound)) + inner.declared
        declarations = f"let {', '.join(variables)}; "
        if kind == "generator" and has_await and not self.native_async:
            return f"$.asyncGeneratorObject((function* ($0) {{ {declarations}{text} }})({first}))", True
        if kind == "generator":
            return f"({'async ' if has_await else ''}function* ($0) {{ {declarations}{text} }})({first})", True
        result = {"list": "$r", "set": "$b.set($r)", "dict": "$b.dict($r)"}[kind]
        if has_await and not self.native_async:
            return f"yield* (function* ($0) {{ {declarations}const $r = []; {text} return {result}; }})({first})", False
        body = f"($0) => {{ {declarations}const $r = []; {text} return {result}; }}"
        if has_await:
            return f"await (async {body})({first})", False
        return f"({body})({first})", True

    def e_ListComp(self, node, scope):
        return self.comprehension(node, scope, "list")

    def e_SetComp(self, node, scope):
        return self.comprehension(node, scope, "set")

    def e_DictComp(self, node, scope):
        return self.comprehension(node, scope, "dict")

    def e_GeneratorExp(self, node, scope):
        return self.comprehension(node, scope, "generator")

    # ---- Assignment ----

    def assign(self, target, value, scope):
        """Statements that assign the value, which is text that may be evaluated once, to the target."""
        if isinstance(target, ast.Name):
            return [self.store_name(target.id, value, scope)]
        if isinstance(target, ast.Attribute):
            name = self.mangler(scope)(target.attr)
            if self.is_test_case(target.value, scope):
                return [f"{self.js_name(target.value.id)}.{name} = {value};"]
            return [f"$.setattr({self.x(target.value, scope)}, {js_string(name)}, {value});"]
        if isinstance(target, ast.Subscript):
            return [f"$.setitem({self.x(target.value, scope)}, {self.subscript_key(target.slice, scope)}, {value});"]
        if isinstance(target, (ast.Tuple, ast.List)):
            return self.unpack(target, value, scope)
        raise Skip(f"syntax: assignment to {type(target).__name__}")

    def unpack(self, target, value, scope):
        stars = [index for index, item in enumerate(target.elts) if isinstance(item, ast.Starred)]
        count = len(target.elts)
        if stars:
            unpacked = f"$.unpack({value}, {stars[0]}, {count - stars[0] - 1})"
        else:
            unpacked = f"$.unpack({value}, {count})"
        items = [item.value if isinstance(item, ast.Starred) else item for item in target.elts]
        if all(isinstance(item, ast.Name) and self.resolve(self.mangler(scope)(item.id), scope)[0] != "class" for item in items):
            if not items:
                return [unpacked + ";"]
            mangle = self.mangler(scope)
            return [f"[{', '.join(self.js_name(mangle(item.id)) for item in items)}] = {unpacked};"]
        temporary = self.temp(scope)
        lines = [f"{temporary} = {unpacked};"]
        for index, item in enumerate(items):
            lines += self.assign(item, f"{temporary}[{index}]", scope)
        return lines

    def target_runs_code(self, target):
        """Whether to evaluate the parts of the target may do something that shows."""
        if isinstance(target, ast.Name):
            return False
        if isinstance(target, ast.Attribute):
            return not self.is_repeatable(target.value)
        if isinstance(target, ast.Subscript):
            return not (self.is_repeatable(target.value) and self.is_repeatable(target.slice))
        return True

    def s_Assign(self, node, scope):
        value = self.x(node.value, scope)
        if len(node.targets) == 1:
            target = node.targets[0]
            if isinstance(target, (ast.Tuple, ast.List)) and isinstance(node.value, (ast.Tuple, ast.List)):
                # a, b = b, a
                if (
                    len(target.elts) == len(node.value.elts)
                    and not any(isinstance(item, ast.Starred) for item in target.elts + node.value.elts)
                    and all(isinstance(item, ast.Name) and self.resolve(self.mangler(scope)(item.id), scope)[0] != "class" for item in target.elts)
                    and target.elts
                ):
                    mangle = self.mangler(scope)
                    names = ", ".join(self.js_name(mangle(item.id)) for item in target.elts)
                    return [f"[{names}] = [{self.elements(node.value.elts, scope)}];"]
            if not self.target_runs_code(target) or self.is_repeatable(node.value) or isinstance(target, (ast.Tuple, ast.List)):
                return self.assign(target, value, scope)
        # The value comes first, then the targets from left to right.
        temporary = self.temp(scope)
        lines = [f"{temporary} = {value};"]
        for target in node.targets:
            lines += self.assign(target, temporary, scope)
        return lines

    def s_AnnAssign(self, node, scope):
        lines = []
        if node.value is not None:
            lines = self.assign(node.target, self.x(node.value, scope), scope)
        if scope.kind == "class" and isinstance(node.target, ast.Name) and node.simple:
            name = self.mangler(scope)(node.target.id)
            if self.future_annotations:
                lines.append(f"$.annotate({scope.namespace}, {js_string(name)}, {self.annotation(node.annotation, scope)});")
            else:
                # They are evaluated when somebody asks.
                scope.annotations.append(self.annotation_entry(name, node.annotation, scope))
        return lines

    def s_AugAssign(self, node, scope):
        operator = INPLACE[type(node.op)]
        target = node.target
        if isinstance(target, ast.Name):
            load = self.load_name(target.id, scope)
            return [self.store_name(target.id, f"$.{operator}({load}, {self.x(node.value, scope)})", scope)]
        lines = []

        def once(part, text):
            if self.is_repeatable(part):
                return text
            temporary = self.temp(scope)
            lines.append(f"{temporary} = {text};")
            return temporary

        if isinstance(target, ast.Attribute):
            name = self.mangler(scope)(target.attr)
            if self.is_test_case(target.value, scope):
                place = f"{self.js_name(target.value.id)}.{name}"
                return [f"{place} = $.{operator}({place}, {self.x(node.value, scope)});"]
            owner = once(target.value, self.x(target.value, scope))
            lines.append(f"$.setattr({owner}, {js_string(name)}, $.{operator}($.attr({owner}, {js_string(name)}), {self.x(node.value, scope)}));")
            return lines
        if isinstance(target, ast.Subscript):
            owner = once(target.value, self.x(target.value, scope))
            key = once(target.slice, self.subscript_key(target.slice, scope))
            lines.append(f"$.setitem({owner}, {key}, $.{operator}($.getitem({owner}, {key}), {self.x(node.value, scope)}));")
            return lines
        raise Skip("syntax: augmented assignment")

    def s_Delete(self, node, scope):
        lines = []
        for target in node.targets:
            for item in target.elts if isinstance(target, (ast.Tuple, ast.List)) else [target]:
                if isinstance(item, ast.Name):
                    name = self.mangler(scope)(item.id)
                    if self.resolve(name, scope)[0] == "class":
                        lines.append(f"$.delitem({scope.namespace}, {js_string(name)});")
                    else:
                        lines.append(f"{self.js_name(name)} = undefined;")
                elif isinstance(item, ast.Attribute):
                    lines.append(f"$b.delattr({self.x(item.value, scope)}, {js_string(self.mangler(scope)(item.attr))});")
                elif isinstance(item, ast.Subscript):
                    lines.append(f"$.delitem({self.x(item.value, scope)}, {self.subscript_key(item.slice, scope)});")
                else:
                    raise Skip("syntax: del")
        return lines

    # ---- Statements ----

    def block(self, body, scope):
        lines = []
        for statement in body:
            lines += self.statement(statement, scope)
        return lines

    def statement(self, node, scope):
        method = getattr(self, "s_" + type(node).__name__, None)
        if method is None:
            raise Skip(f"syntax: {type(node).__name__}")
        return method(node, scope)

    def s_Expr(self, node, scope):
        if isinstance(node.value, ast.Constant):
            return []
        text = self.x(node.value, scope)
        # A statement cannot begin so.
        if text.startswith(("{", "function", "async function", "class", "let", "[")):
            text = f"({text})"
        return [text + ";"]

    def s_Pass(self, node, scope):
        return []

    def s_Global(self, node, scope):
        return []

    s_Nonlocal = s_Global

    def s_Return(self, node, scope):
        return ["return;" if node.value is None else f"return {self.x(node.value, scope)};"]

    def s_Assert(self, node, scope):
        message = self.x(node.msg, scope) if node.msg is not None else ""
        return [f"if (!{self.condition(node.test, scope, True)}) throw $b.AssertionError({message});"]

    def s_Raise(self, node, scope):
        if node.exc is None:
            if not scope.handlers:
                raise Skip("raise without an exception outside a handler")
            return [f"throw {scope.handlers[-1]};"]
        if node.cause is not None:
            return [f"throw $.exception({self.x(node.exc, scope)}, {self.x(node.cause, scope)});"]
        if isinstance(node.exc, ast.Call) and self.is_builtin(node.exc.func, scope) and node.exc.func.id.endswith(("Error", "Exception")):
            return [f"throw {self.x(node.exc, scope)};"]
        return [f"throw $.exception({self.x(node.exc, scope)});"]

    def s_If(self, node, scope):
        lines = [f"if ({self.condition(node.test, scope)}) {{", *indent(self.block(node.body, scope))]
        orelse = node.orelse
        while len(orelse) == 1 and isinstance(orelse[0], ast.If):
            lines += [f"}} else if ({self.condition(orelse[0].test, scope)}) {{", *indent(self.block(orelse[0].body, scope))]
            orelse = orelse[0].orelse
        if orelse:
            lines += ["} else {", *indent(self.block(orelse, scope))]
        lines.append("}")
        return lines

    def loop(self, head, prelude, node, scope):
        label = f"$L{self.uid()}" if node.orelse else None
        scope.loops.append(label)
        try:
            body = self.block(node.body, scope)
        finally:
            scope.loops.pop()
        lines = [head + " {", *indent(prelude + body), "}"]
        if label:
            lines = [f"{label}: {{", *indent(lines + self.block(node.orelse, scope)), "}"]
        return lines

    def s_While(self, node, scope):
        return self.loop(f"while ({self.condition(node.test, scope)})", [], node, scope)

    def loop_target(self, target, scope):
        """What stands before `of`, and the statements that begin the body."""
        if isinstance(target, ast.Name) and self.resolve(self.mangler(scope)(target.id), scope)[0] != "class":
            return self.js_name(self.mangler(scope)(target.id)), []
        item = f"$i{self.uid()}"
        return f"const {item}", self.assign(target, item, scope)

    def s_For(self, node, scope):
        head, prelude = self.loop_target(node.target, scope)
        return self.loop(f"for ({head} of $.iter({self.x(node.iter, scope)}))", prelude, node, scope)

    def s_AsyncFor(self, node, scope):
        if not scope.is_async:
            raise Skip("await outside an async function")
        if self.native_async:
            head, prelude = self.loop_target(node.target, scope)
            return self.loop(f"for await ({head} of $.aiter({self.x(node.iter, scope)}))", prelude, node, scope)
        before, head, prelude = self.async_loop(node.target, self.x(node.iter, scope), scope)
        return ["{", *indent([before, *self.loop(head, prelude, node, scope)]), "}"]

    def async_loop(self, target, iterable, scope):
        """async for target in iterable: a statement that comes first, the head of the loop, and what its body begins with."""
        number = self.uid()
        iterator, item, thrown = f"$a{number}", f"$i{number}", f"$e{number}"
        return (
            f"const {iterator} = $.aiterRaw({iterable});",
            "while (true)",
            [
                f"let {item};",
                f"try {{ {item} = {self.wait(f'$.anextRaw({iterator})')}; }} catch ({thrown}) {{ if ($.matches({thrown}, $b.StopAsyncIteration)) break; throw {thrown}; }}",
                *self.assign(target, item, scope),
            ],
        )

    def s_Break(self, node, scope):
        label = scope.loops[-1]
        return [f"break {label};" if label else "break;"]

    def s_Continue(self, node, scope):
        return ["continue;"]

    def s_Try(self, node, scope):
        lines = ["try {", *indent(self.block(node.body, scope))]
        label = None
        if node.handlers:
            thrown = f"$e{self.uid()}"
            label = f"$T{self.uid()}" if node.orelse else None
            clauses = []
            has_catch_all = False
            for index, handler in enumerate(node.handlers):
                if handler.type is None:
                    test = f"$.matchesAny({thrown})"
                else:
                    test = f"$.matches({thrown}, {self.x(handler.type, scope)})"
                scope.handlers.append(thrown)
                try:
                    body = self.block(handler.body, scope)
                finally:
                    scope.handlers.pop()
                if handler.name:
                    body.insert(0, self.store_name(handler.name, thrown, scope))
                clauses += [f"{'} else ' if index else ''}if ({test}) {{", *indent(body)]
            clauses += ["} else throw " + thrown + ";"]
            if label:
                clauses.append(f"break {label};")
            lines += [f"}} catch ({thrown}) {{", *indent(clauses)]
        if label:
            lines = [f"{label}: {{", *indent(lines + ["}"] + self.block(node.orelse, scope)), "}"]
            if node.finalbody:
                lines = ["try {", *indent(lines)]
        elif node.orelse:
            # try ... else ... finally, without handlers
            lines += indent(self.block(node.orelse, scope))
        if node.finalbody:
            lines += ["} finally {", *indent(self.block(node.finalbody, scope))]
        if node.finalbody or not label:
            lines.append("}")
        return lines

    def with_statement(self, manager, target, body, scope, is_async):
        """with manager as target: body. This is the one place that says what `with` is in JavaScript."""
        number = self.uid()
        name, ok, thrown = f"$w{number}", f"$ok{number}", f"$e{number}"
        if is_async and not self.native_async:
            entered = self.wait(f"$.aenterRaw({name})")
            failed = f"$.bool({self.wait(f'$.aexitRaw({name}, {thrown})')})"
            left = self.wait(f"$.aexitRaw({name})")
        else:
            wait = "await " if is_async else ""
            prefix = "a" if is_async else ""
            entered = f"{wait}$.{prefix}enter({name})"
            failed = f"({wait}$.{prefix}exit({name}, {thrown}))"
            left = f"{wait}$.{prefix}exit({name})"
        return [
            "{",
            *indent(
                [
                    f"const {name} = {manager};",
                    *(self.assign(target, entered, scope) if target is not None else [entered + ";"]),
                    f"let {ok} = true;",
                    "try {",
                    *indent(body),
                    f"}} catch ({thrown}) {{",
                    f"  {ok} = false;",
                    f"  if (!{failed}) throw {thrown};",
                    "} finally {",
                    f"  if ({ok}) {left};",
                    "}",
                ]
            ),
            "}",
        ]

    @staticmethod
    def leaves_block(body):
        """Whether there is something in the block that a function of its own could not do: return, yield, await, or leave a loop around it."""

        def look(nodes, in_loop):
            for node in nodes:
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda, ast.ClassDef)):
                    continue
                if isinstance(node, (ast.Return, ast.Yield, ast.YieldFrom, ast.Await, ast.AsyncFor, ast.AsyncWith)):
                    return True
                if isinstance(node, (ast.Break, ast.Continue)) and not in_loop:
                    return True
                if isinstance(node, (ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)) and any(g.is_async for g in node.generators):
                    return True
                if look(ast.iter_child_nodes(node), in_loop or isinstance(node, (ast.For, ast.While))):
                    return True
            return False

        return look(body, False)

    def s_With(self, node, scope, is_async=False):
        as_call = not is_async and not self.inline_with and scope.kind != "class" and not self.leaves_block(node.body)

        def nest(items):
            if not items:
                if not as_call:
                    return self.block(node.body, scope)
                # `break` in a loop in the block is that loop's.
                loops, scope.loops = scope.loops, []
                try:
                    return self.block(node.body, scope)
                finally:
                    scope.loops = loops
            item = items[0]
            manager = self.x(item.context_expr, scope)
            if as_call:
                value = f"$v{self.uid()}"
                assignment = self.assign(item.optional_vars, value, scope) if item.optional_vars is not None else []
                return [f"$.with_({manager}, {f'{value} =>' if assignment else '() =>'} {{", *indent(assignment + nest(items[1:])), "});"]
            return self.with_statement(manager, item.optional_vars, nest(items[1:]), scope, is_async)

        return nest(node.items)

    def s_AsyncWith(self, node, scope):
        if not scope.is_async:
            raise Skip("await outside an async function")
        return self.s_With(node, scope, True)

    # ---- Imports ----

    def depends_on(self, name):
        if name in self.libraries and name != self.module_name and name not in self.dependencies:
            self.dependencies.append(name)

    def s_Import(self, node, scope):
        lines = []
        for alias in node.names:
            self.depends_on(alias.name)
            imported = f"$.importModule({js_string(alias.name)})"
            if alias.asname:
                lines.append(self.store_name(alias.asname, imported + "[1]", scope))
            else:
                lines.append(self.store_name(alias.name.partition(".")[0], imported + "[0]", scope))
        return lines

    def s_ImportFrom(self, node, scope):
        if node.module == "__future__":
            return []
        name = node.module or ""
        if node.level:
            package = self.package.split(".")
            if node.level > 1:
                package = package[: -(node.level - 1)]
            name = ".".join(package + ([name] if name else []))
        lines = []
        self.depends_on(name)
        for alias in node.names:
            self.depends_on(f"{name}.{alias.name}")
            if alias.name == "*":
                if scope.kind != "module":
                    raise Skip("import * outside the module")
                lines.append(f"$stars.push($.importStar({js_string(name)}));")
            else:
                lines.append(self.store_name(alias.asname or alias.name, f"$.importFrom({js_string(name)}, {js_string(alias.name)})", scope))
        return lines

    # ---- Classes ----

    def s_ClassDef(self, node, scope):
        if getattr(node, "type_params", None):
            raise Skip("type parameters")
        for base in node.bases:
            if isinstance(base, ast.Name) and base.id in self.skipped_classes and self.resolve(base.id, scope)[0] == "variable":
                raise Skip(self.skipped_classes[base.id])
        if self.native_classes:
            saved = (dict(self.manifest), dict(self.left_out), list(scope.declared), dict(self.workarounds))
            try:
                return self.native_class(node, scope)
            except NotNative:
                self.manifest, self.left_out, scope.declared[:], self.workarounds = saved
        number = self.uid()
        inner = Scope("class", scope, node.name)
        inner.namespace = f"$ns{number}"
        inner.cell = f"$cell{number}"
        inner.is_test_class = node.name in self.test_classes
        mangle = self.mangler(inner)
        binder = Binder(inner, mangle)
        for statement in node.body:
            binder.visit(statement)
        self.module.bound |= inner.globals

        decorators = [self.a(decorator, scope) for decorator in node.decorator_list]
        bases = self.elements(node.bases, scope)
        keywords = []
        for keyword in node.keywords:
            if keyword.arg is None:
                raise Skip("class with **keywords")
            keywords.append(f"{js_key(keyword.arg)}: {self.x(keyword.value, scope)}")

        if node.name in scope.globals:
            inner.qualname = node.name
            inner.prefix = node.name + "."
        body = [f"$.setitem({inner.namespace}, \"__firstlineno__\", {node.lineno});"]
        doc = self.docstring(node.body)
        if doc is not None:
            body.append(f"$.setitem({inner.namespace}, \"__doc__\", {js_string(doc)});")
        for statement in node.body[1:] if doc is not None else node.body:
            if not isinstance(statement, (ast.FunctionDef, ast.AsyncFunctionDef)):
                body += self.statement(statement, inner)
                continue
            key = f"{inner.qualname}.{statement.name}"
            saved = (self.counter, list(inner.declared))
            try:
                lines = self.statement(statement, inner)
            except Skip as skip:
                reason = str(skip)
                inner.declared[:] = saved[1]
                if is_test_name(statement.name) and inner.is_test_class:
                    self.manifest[key] = reason
                else:
                    self.left_out[key] = reason
                if True:
                    body.append(f"$.setitem({inner.namespace}, {js_string(mangle(statement.name))}, $.untranslated({js_string(key)}, {js_string(reason)}));")
                continue
            if is_test_name(statement.name) and inner.is_test_class:
                self.manifest[key] = "ok"
            body += lines
        if inner.annotations:
            body.append(f"$.setitem({inner.namespace}, \"__annotate_func__\", $.annotator([{', '.join(inner.annotations)}], $n));")
        body.append(f"$.setitem({inner.namespace}, \"__static_attributes__\", $.t({', '.join(map(js_string, self.static_attributes(node)))}));")
        if inner.declared:
            body.insert(0, f"let {', '.join(inner.declared)};")

        head = f"$.class_({js_string(node.name)}, {js_string(inner.qualname)}, $n, [{bases}], {{ {', '.join(keywords)} }}, {f'({inner.namespace}, {inner.cell})' if inner.needs_cell else inner.namespace} => {{"
        lines = [head.replace("{  }", "{}"), *indent(body), "}, true)" if inner.needs_cell else "})"]
        for decorator in reversed(decorators):
            lines = wrap(decorator + "(", lines, ")")
        # No variable but the one of the program has the class: some tests wait for it to die.
        name = self.mangler(scope)(node.name)
        if self.resolve(name, scope)[0] == "class":
            return wrap(f"$.setitem({scope.namespace}, {js_string(name)}, ", lines, ");")
        if name in scope.globals:
            return wrap(f"{self.js_name(name)} = $m.{name} = ", lines, ";")
        return wrap(f"{self.js_name(name)} = ", lines, ";")

    def is_plain_value(self, node):
        """An expression that is the same wherever and whenever it is evaluated, and no descriptor."""
        if isinstance(node, ast.Constant):
            return True
        if isinstance(node, (ast.Tuple, ast.List, ast.Set)):
            return all(self.is_plain_value(item) for item in node.elts)
        if isinstance(node, ast.Dict):
            return all(key is not None and self.is_plain_value(key) and self.is_plain_value(value) for key, value in zip(node.keys, node.values))
        return self.constant_number(node) is not None

    def has_plain_metaclass(self, base, scope):
        """Whether to set an attribute of a class derived from the base, once it is made, is as good as to have it in the body."""
        if isinstance(base, ast.Name):
            kind = self.resolve(base.id, scope)[0]
            return kind == "builtin" or (kind == "variable" and base.id in self.native_class_names)
        return isinstance(base, ast.Attribute) and isinstance(base.value, ast.Name) and base.value.id == "unittest" and base.attr == "TestCase"

    def native_class(self, node, scope):
        """class Name extends Base { ... }, or NotNative."""
        if len(node.bases) > 1 or node.keywords or node.decorator_list or scope.kind == "class" or node.name in RESERVED or not node.name.isascii():
            raise NotNative
        if node.bases and not isinstance(node.bases[0], (ast.Name, ast.Attribute)):
            raise NotNative  # Generic[T] is no class, and `extends` wants one.
        if not node.bases and node.name in self.test_classes:
            raise NotNative  # A mixin. The __new__ and __init__ of a class of JavaScript's hide those of the bases that follow it.
        inner = Scope("class", scope, node.name)
        inner.is_native = True
        inner.class_variable = node.name  # In the class, its name is bound to it.
        inner.is_test_class = node.name in self.test_classes
        if node.name in scope.globals:
            inner.qualname = node.name
            inner.prefix = node.name + "."
        mangle = self.mangler(inner)
        has_plain_metaclass = not node.bases or self.has_plain_metaclass(node.bases[0], scope)
        base = self.a(node.bases[0], scope) if node.bases else "$b.object"
        members = [f"static __module__ = $n;", f"static __qualname__ = {js_string(inner.qualname)};"]
        doc = self.docstring(node.body)
        if doc is not None:
            members.append(f"static __doc__ = {js_string(doc)};")
        seen = set()
        for statement in node.body[1:] if doc is not None else node.body:
            if isinstance(statement, ast.Pass):
                continue
            if isinstance(statement, ast.Assign):
                target = statement.targets[0]
                if len(statement.targets) != 1 or not isinstance(target, ast.Name) or not has_plain_metaclass:
                    raise NotNative
                name = mangle(target.id)
                if name.startswith("__") or name in seen or not self.is_plain_value(statement.value) or name in ("name", "length", "prototype", "constructor"):
                    raise NotNative
                seen.add(name)
                members.append(f"static {js_key(name)} = {self.x(statement.value, scope)};")
                continue
            if not isinstance(statement, ast.FunctionDef) or getattr(statement, "type_params", None):
                raise NotNative
            name = mangle(statement.name)
            # The constructor of such a class makes and initializes the instance as the base does, with all the arguments.
            if name == "__new__" or (name == "__init__" and node.bases and not self.is_builtin(node.bases[0], scope, ("object",))):
                raise NotNative
            if name in ("constructor", "prototype", "__init_subclass__", "__class_getitem__", "__set_name__"):
                raise NotNative
            decorators = statement.decorator_list
            method = ("", True)
            key = name
            if len(decorators) == 1 and self.is_builtin(decorators[0], scope, ("staticmethod", "classmethod", "property")):
                method = {"staticmethod": ("static ", False), "classmethod": ("static ", True), "property": ("get ", True)}[decorators[0].id]
                if decorators[0].id != "property" and name in ("name", "length"):
                    raise NotNative
                key = (method[0], name)
            elif (
                len(decorators) == 1
                and isinstance(decorators[0], ast.Attribute)
                and decorators[0].attr == "setter"
                and isinstance(decorators[0].value, ast.Name)
                and decorators[0].value.id == statement.name
                and ("get ", name) in seen
            ):
                method = ("set ", True)
                key = ("set ", name)
            elif decorators:
                raise NotNative
            if key in seen or (isinstance(key, str) and (("get ", name) in seen or ("static ", name) in seen)):
                raise NotNative
            seen.add(key)
            identifier = f"{inner.qualname}.{statement.name}"
            is_test = is_test_name(statement.name) and inner.is_test_class
            function_doc = self.docstring(statement.body)
            if function_doc is not None and not inner.is_test_class:
                raise NotNative
            saved = list(inner.declared)
            try:
                lines = self.function(statement.args, statement.body[1:] if function_doc is not None else statement.body, name, inner, is_static=method[0] == "static ", method=method)
            except Skip as skip:
                reason = str(skip)
                (self.manifest if is_test else self.left_out)[identifier] = reason
                members += [f"{js_key(name)}() {{", f"  $.untranslated({js_string(identifier)}, {js_string(reason)})();", "}"]
                continue
            if is_test:
                self.manifest[identifier] = "ok"
            members += lines
            if name == "__init__":
                members += ["constructor() {", "  super();", "}"]
        if inner.declared:
            raise NotNative
        self.native_class_names.add(node.name)
        self.native_count += 1
        return wrap(self.store_name(node.name, "", scope)[:-1], [f"class {node.name} extends {base} {{", *indent(members), "}"], ";")

    @staticmethod
    def static_attributes(node):
        """The names of the attributes that the methods of the class assign to `self`."""
        names = set()
        for method in node.body:
            if isinstance(method, (ast.FunctionDef, ast.AsyncFunctionDef)) and (method.args.posonlyargs or method.args.args):
                first = (method.args.posonlyargs + method.args.args)[0].arg
                for inner in ast.walk(method):
                    if (
                        isinstance(inner, ast.Attribute)
                        and isinstance(inner.ctx, ast.Store)
                        and isinstance(inner.value, ast.Name)
                        and inner.value.id == first
                    ):
                        names.add(inner.attr)
        return sorted(names)

    # ---- The module ----

    def count_tests(self, node, prefix, reason):
        """Every test method of the class is left out, for that reason."""
        for item in node.body:
            if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)) and is_test_name(item.name):
                self.manifest[f"{prefix}{node.name}.{item.name}"] = reason

    def translate(self):
        module = self.module
        binder = Binder(module, lambda name: name)
        for statement in self.tree.body:
            binder.visit(statement)
        for node in ast.walk(self.tree):
            if isinstance(node, ast.Global) and not BUILTINS.intersection(node.names):
                module.bound.update(node.names)
            if isinstance(node, ast.ImportFrom):
                if node.module == "__future__":
                    self.future_annotations |= any(alias.name == "annotations" for alias in node.names)
                elif any(alias.name == "*" for alias in node.names):
                    self.has_star_import = True

        body = []
        statements = self.tree.body
        if self.docstring(statements) is not None:
            statements = statements[1:]
        for statement in statements:
            if self.is_main_guard(statement):
                body += self.block(statement.orelse, module)
                continue
            if isinstance(statement, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                saved = dict(self.manifest)
                try:
                    body += self.statement(statement, module)
                except Skip as skip:
                    reason = str(skip)
                    self.manifest = saved
                    self.left_out[statement.name] = reason
                    if isinstance(statement, ast.ClassDef):
                        self.skipped_classes[statement.name] = reason
                        if statement.name in self.test_classes:
                            self.count_tests(statement, "", reason)
                    body.append(f"{self.js_name(statement.name)} = $.untranslated({js_string(statement.name)}, {js_string(reason)});")
            else:
                body += self.statement(statement, module)

        names = sorted(module.bound)
        exported = ", ".join(n if self.js_name(n) == n else f"{js_key(n)}: {self.js_name(n)}" for n in names)
        # The translation of test.a.b is a/b.test.ts, beside support.ts.
        depth = len(self.module_name.removeprefix("test.").split(".")) - 1 + (1 if self.is_package else 0)
        up = "../" * depth if depth else "./"
        lines = [
            "// @ts-nocheck",
            f"// Translated from Lib/test of CPython by translate.py: {self.module_name}",
            f"import * as $ from {js_string(up + 'support')};",
            *(f"import {js_string(up + name.removeprefix('test.').replace('.', '/') + '.ts')};" for name in self.dependencies),
            "const $b = $.builtins;",
            f"const $n = {js_string(self.module_name)};",
            "let $m;",
        ]
        if self.has_star_import:
            lines.append("const $stars = [];")
        variables = [self.js_name(n) for n in names] + module.declared + (["$raw"] if self.raw_calls else [])
        if variables:
            lines.append(f"let {', '.join(variables)};")
        if self.raw_calls:
            body.insert(0, "$raw = $.rawFor($n);")
        body.insert(0, f"$m = $.module($n, {'true' if self.is_package else 'false'});")
        is_library = ", true" if self.is_library else ""
        lines += ["try {", *indent(body), f"  $.finish($m, {{ {exported} }}{is_library});", "} catch ($e) {", f"  $.failedToLoad($e, $n{is_library});", "}", ""]
        return "\n".join(lines)

    @staticmethod
    def is_main_guard(node):
        return (
            isinstance(node, ast.If)
            and isinstance(node.test, ast.Compare)
            and isinstance(node.test.left, ast.Name)
            and node.test.left.id == "__name__"
        )


def count_test_methods(tree):
    return sum(
        1
        for node in ast.walk(tree)
        if isinstance(node, ast.ClassDef)
        for item in node.body
        if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)) and is_test_name(item.name)
    )


def translate_file(path, module_name, output, libraries=frozenset(), is_library=False, **options):
    """Writes the translation, if there is one, and returns the manifest."""
    with open(path, "rb") as file:
        source = file.read()
    manifest = {"module": module_name, "file": None, "tests": {}, "left_out": {}, "methods": 0}
    try:
        translator = Translator(source, module_name, os.path.basename(path) == "__init__.py", libraries, is_library, **options)
    except SyntaxError as error:
        manifest["file"] = f"syntax error: {error.msg}"
        return manifest
    manifest["methods"] = count_test_methods(translator.tree)
    try:
        text = translator.translate()
    except Skip as skip:
        manifest["file"] = str(skip)
        return manifest
    except RecursionError:
        manifest["file"] = "too deep"
        return manifest
    manifest["tests"] = translator.manifest
    manifest["left_out"] = translator.left_out
    manifest["workarounds"] = translator.workarounds
    manifest["libraries"] = translator.dependencies
    manifest["native_classes"] = translator.native_count
    os.makedirs(os.path.dirname(output) or ".", exist_ok=True)
    with open(output, "w", encoding="utf-8", errors="surrogatepass") as file:
        file.write(text)
    return manifest


def main(arguments):
    options = {}
    while arguments and arguments[0].startswith("--"):
        options[arguments.pop(0)[2:].replace("-", "_")] = True
    if len(arguments) != 3 or not options.keys() <= {"native_async", "native_classes", "inline_with"}:
        sys.exit(__doc__)
    path, module_name, output = arguments
    manifest = translate_file(path, module_name, output, **options)
    with open(output.removesuffix(".test.ts") + ".json", "w") as file:
        json.dump(manifest, file, indent=1)
    translated = sum(1 for reason in manifest["tests"].values() if reason == "ok")
    print(f"{module_name}: {translated} of {manifest['methods']} test methods" + (f"; {manifest['file']}" if manifest["file"] else ""))


if __name__ == "__main__":
    main(sys.argv[1:])
