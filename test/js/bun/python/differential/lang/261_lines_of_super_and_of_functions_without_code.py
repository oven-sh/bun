# Lines: `super().name` written over several lines comes to the line of the name after the super object has been asked; a function of whose body no code comes
# (`a: int`, `global b`, a docstring) is on the line of its `def` all the time. dis shows LOAD_SUPER_ATTR where the compiler has made one step of `super().name`.
import dis, sys

class A:
    attr = 1
    def method(self, x):
        return x
class B(A):
    def method(self, x):
        return super(
        ).method(
            x
        )
    def attribute(self):
        return super(
        ).attr
    def with_arguments(self, x):
        return super(B,
            self).method(
            x)
    def attribute_with_arguments(self):
        return super(B, self
            ).attr
    def on_one_line(self, x):
        return super().method(x) + super().attr
class C(A):
    def method(self, x):
        s = super
        return s(C, self
        ).method(
            x
        )

def docstring():
    "doc string"
def annotation():
    a: int
def annotations():
    a: int
    b: str
def docstring_and_more():
    "doc string"
    a: int
    global g
def global_statement():
    global g
def makes_nonlocal_statement():
    x = 1
    def nonlocal_statement():
        nonlocal x
    return nonlocal_statement
def only_pass():
    pass
def annotation_and_pass():
    a: int
    pass
def annotation_with_a_value():
    a: int = 1
def annotation_of_an_attribute():
    A.b: int
async def coroutine_with_an_annotation():
    a: int
def generator_with_an_annotation():
    a: int
    yield

def run(f, *arguments):
    code = f.__code__
    events = []
    def trace(frame, event, argument):
        if frame.f_code is code:
            events.append('%s%s' % (event[0], frame.f_lineno - code.co_firstlineno))
            return trace
    sys.settrace(trace)
    try:
        result = f(*arguments)
        if hasattr(result, 'send'):
            try:
                result.send(None)
            except StopIteration:
                pass
            result.close()
    finally:
        sys.settrace(None)
    print(f.__qualname__, ' '.join(events), sorted({line - code.co_firstlineno for _, _, line in code.co_lines() if line is not None}),
        [(i.opname, i.argrepr) for i in dis.get_instructions(code) if i.opname == 'LOAD_SUPER_ATTR'])

def main():
    b = B()
    run(B.method, b, 1)
    run(B.attribute, b)
    run(B.with_arguments, b, 1)
    run(B.attribute_with_arguments, b)
    run(B.on_one_line, b, 1)
    run(C.method, C(), 1)
    for f in (docstring, annotation, annotations, docstring_and_more, global_statement, makes_nonlocal_statement(), only_pass, annotation_and_pass, annotation_with_a_value,
            annotation_of_an_attribute, coroutine_with_an_annotation, generator_with_an_annotation):
        run(f)
main()
