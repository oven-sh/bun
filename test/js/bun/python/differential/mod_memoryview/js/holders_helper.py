# Called from holders.js.
b = bytearray(b'abc')
def view():
    return memoryview(b)
def blocked():
    try:
        b.append(0)
    except BufferError:
        return True
    b.pop()
    return False
