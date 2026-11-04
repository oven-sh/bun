# What only a temporary of Python code refers to is finalized at once. What JS has been given, or has made, is not.
log = []


def take():
    result = ' '.join(log) or 'nothing'
    log.clear()
    return result


class Exporter:
    def __init__(self):
        self.data = bytearray(b'abcdef')

    def __buffer__(self, flags):
        log.append('export')
        return memoryview(self.data)

    def __release_buffer__(self, view):
        log.append('release')
        view.release()


def gen(name):
    try:
        yield 1
        yield 2
        yield 3
    finally:
        log.append('closed ' + name)


def view_as_argument(function):
    function(memoryview(Exporter()))
    return take()


def slice_as_argument(function):
    function(memoryview(Exporter())[1:3])
    return take()


def view_from(function):
    return bytes(function()).decode() + ' ' + take()


def method_of_view_from(function):
    return function().tobytes().decode() + ' ' + take()


def loop_over(function):
    for value in function():
        break
    return take()


def loop_and_call(function):
    for value in gen('while JS runs'):
        function(value)
        break
    return take()


def loop_and_raise(function):
    try:
        for value in gen('when JS throws'):
            function(value)
    except Exception as e:
        return take() + ', ' + type(e).__name__


def make_view():
    return memoryview(Exporter())
