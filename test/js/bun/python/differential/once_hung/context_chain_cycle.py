# test_exceptions.ExceptionTests.test_no_hang_on_context_chain_cycle1: raising while an exception whose __context__ is itself is being handled
try:
    try:
        raise ValueError(1)
    except ValueError as ex:
        ex.__context__ = ex
        raise TypeError(2)
except Exception as e:
    print(type(e), type(e.__context__), e.__context__.__context__ is e.__context__)
