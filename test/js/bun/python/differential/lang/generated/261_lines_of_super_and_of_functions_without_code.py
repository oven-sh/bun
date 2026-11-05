# Lines: `super().name` written over several lines comes to the line of the name after the super object has been asked; a function of whose body no code comes
# (`a: int`, `global b`, a docstring) is on the line of its `def` all the time. dis shows LOAD_SUPER_ATTR where the compiler has made one step of `super().name`.
try: import dis, sys
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: import dis, sys')

try:
    class A:
        attr = 1
        def method(self, x):
            return x
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class A:')
try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class B(A):')
try:
    class C(A):
        def method(self, x):
            s = super
            return s(C, self
            ).method(
                x
            )
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: class C(A):')

try:
    def docstring():
        "doc string"
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def docstring():')
try:
    def annotation():
        a: int
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def annotation():')
try:
    def annotations():
        a: int
        b: str
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def annotations():')
try:
    def docstring_and_more():
        "doc string"
        a: int
        global g
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def docstring_and_more():')
try:
    def global_statement():
        global g
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def global_statement():')
try:
    def makes_nonlocal_statement():
        x = 1
        def nonlocal_statement():
            nonlocal x
        return nonlocal_statement
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def makes_nonlocal_statement():')
try:
    def only_pass():
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def only_pass():')
try:
    def annotation_and_pass():
        a: int
        pass
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def annotation_and_pass():')
try:
    def annotation_with_a_value():
        a: int = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def annotation_with_a_value():')
try:
    def annotation_of_an_attribute():
        A.b: int
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def annotation_of_an_attribute():')
try:
    async def coroutine_with_an_annotation():
        a: int
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: async def coroutine_with_an_annotation():')
try:
    def generator_with_an_annotation():
        a: int
        yield
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def generator_with_an_annotation():')

try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def run(f, *arguments):')

try:
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
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def main():')
try: main()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: main()')
