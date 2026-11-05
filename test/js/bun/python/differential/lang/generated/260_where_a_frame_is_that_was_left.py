# Where a frame is found to be that an exception has left: f_lineno of the frame of each entry of the traceback, beside tb_lineno. What raises an exception again on behalf of the
# program (at the end of a handler, a `with`, a `finally` clause) does so as if from where it was last raised. What is left over of an `except*` statement is raised from no line.
try:
    def generator_raises_again_after_a_yield():
        try:
            {}['marker']
        except KeyError:
            yield 1
            x = 1
            raise
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def generator_raises_again_after_a_yield():')
try:
    def generator_raises_again():
        try:
            {}['marker']
        except KeyError:
            x = 1
            raise
        yield
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def generator_raises_again():')
try:
    def function_raises_again():
        try:
            {}['marker']
        except KeyError:
            x = 1
            raise
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def function_raises_again():')
try:
    def generator_raises_the_name_after_a_yield():
        try:
            {}['marker']
        except KeyError as e:
            yield 1
            raise e
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def generator_raises_the_name_after_a_yield():')
try:
    def generator_yields_in_a_finally_clause():
        try:
            {}['marker']
        finally:
            yield 1
            x = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def generator_yields_in_a_finally_clause():')
try:
    def raise_in_except_star_in_a_try():
        try:
            try:
                {}['marker']
            except* KeyError:
                x = 1
                raise ValueError('out')
        except ValueError:
            raise
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def raise_in_except_star_in_a_try():')
try:
    def raises_again_in_except_star():
        try:
            {}['marker']
        except* KeyError:
            x = 1
            raise
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def raises_again_in_except_star():')
try:
    def except_star_that_does_not_match():
        try:
            {}['marker']
        except* ValueError:
            x = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def except_star_that_does_not_match():')
try:
    def raise_in_except_star_in_a_handler():
        try:
            raise ValueError('outer')
        except ValueError:
            try:
                {}['marker']
            except* KeyError:
                x = 1
                raise ValueError('out')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def raise_in_except_star_in_a_handler():')
try:
    def raises_again_in_except_star_in_a_handler():
        try:
            raise ValueError('outer')
        except ValueError:
            try:
                {}['marker']
            except* KeyError:
                x = 1
                raise
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def raises_again_in_except_star_in_a_handler():')
try:
    def raise_in_a_handler_in_a_handler():
        try:
            raise ValueError('outer')
        except ValueError:
            try:
                {}['marker']
            except KeyError:
                x = 1
                raise ValueError('out')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def raise_in_a_handler_in_a_handler():')
try:
    def except_star_that_does_not_match_in_a_handler():
        try:
            raise ValueError('outer')
        except ValueError:
            try:
                {}['marker']
            except* ValueError:
                x = 1
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def except_star_that_does_not_match_in_a_handler():')
try:
    def raise_in_except_star_in_a_finally_clause():
        try:
            raise ValueError('outer')
        finally:
            try:
                {}['marker']
            except* KeyError:
                x = 1
                raise ValueError('out')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def raise_in_except_star_in_a_finally_clause():')
try:
    def raise_in_except_star_in_a_with():
        with open('/dev/null'):
            try:
                {}['marker']
            except* KeyError:
                x = 1
                raise ValueError('out')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def raise_in_except_star_in_a_with():')
try:
    def raise_in_except_star():
        try:
            {}['marker']
        except* KeyError:
            x = 1
            raise ValueError('out')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def raise_in_except_star():')
try:
    def raise_in_except_star_in_a_handler_with_a_name():
        try:
            raise ValueError('outer')
        except ValueError as e:
            try:
                {}['marker']
            except* KeyError:
                raise ValueError('out')
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def raise_in_except_star_in_a_handler_with_a_name():')

try:
    def main():
        for f in [value for name, value in globals().items() if hasattr(value, '__code__') and name != 'main']:
            try:
                result = f()
                if result is not None:
                    list(result)
            except BaseException as e:
                tb = e.__traceback__.tb_next
                rows = []
                while tb:
                    code = tb.tb_frame.f_code
                    line = tb.tb_frame.f_lineno
                    rows.append((tb.tb_lineno - code.co_firstlineno, None if line is None else line - code.co_firstlineno, tb.tb_lasti == tb.tb_frame.f_lasti))
                    tb = tb.tb_next
                print(f.__name__, type(e).__name__, rows)
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: def main():')
try: main()
except Exception as _pe: print('<!' + type(_pe).__name__ + ": " + str(_pe) + '> in: main()')
