# The stream readers and writers, over streams that hand out the bytes in pieces of every size.
import io, os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

class Pieces:
    """Gives at most `most` bytes at a time, whatever is asked for."""
    def __init__(self, data, most):
        self.data, self.most, self.calls = data, most, []
    def read(self, size=-1):
        self.calls.append(('read', size))
        n = self.most if size < 0 else min(size, self.most)
        result, self.data = self.data[:n], self.data[n:]
        return result
    def readline(self, size=-1):
        self.calls.append(('readline', size))
        end = self.data.find(b'\n') + 1 or len(self.data)
        n = min(end, self.most) if size < 0 else min(end, size, self.most)
        result, self.data = self.data[:n], self.data[n:]
        return result

def drain(function, *args):
    results = []
    while len(results) < 2000:
        result = outcome(function, *args)
        results.append(result)
        if not result or (isinstance(result, str) and result.startswith('Unicode')):
            break
    return results

for name in GROUPS['tw']:
    info = codecs.lookup(name)
    text = sample(name) * 2
    data = info.encode(text)[0]
    print(name, len(text), len(data))
    for size in (None, -1, 1, 2, 3, 5, 8, 100, 10000):
        args = () if size is None else (size,)
        results = []
        for most in (1, 2, 3, 4, 7, 9, 16, 10000):
            for method in ('read', 'readline'):
                stream = Pieces(data, most)
                reader = info.streamreader(stream)
                got = drain(getattr(reader, method), *args)
                results.append((got, stream.calls))
                if size is not None and size > 0 and ''.join(got) != text:
                    print('  lost', size, most, method)
        print('  read', size, crc(results))
    print('  whole', info.streamreader(io.BytesIO(data)).read() == text, info.streamreader(io.BytesIO(data)).readlines() == text.splitlines(True),
          list(info.streamreader(io.BytesIO(data))) == text.splitlines(True), crc(info.streamreader(io.BytesIO(data)).readlines(7)))
    # Data that ends in the middle of a character.
    for errors in ('strict', 'ignore', 'replace', 'backslashreplace'):
        results = []
        for i in range(0, len(data) // 2):
            for args in ((), (3,)):
                reader = info.streamreader(io.BytesIO(data[:i]), errors)
                results.append(drain(reader.read, *args))
        print('  cut', errors, crc(results))
    # reset() forgets what is pending.
    results = []
    for i in range(len(data) // 2):
        stream = io.BytesIO(data)
        reader = info.streamreader(stream)
        first = reader.read(i + 1)
        reader.reset()
        results.append((first, stream.tell(), outcome(reader.read)))
    print('  reset', crc(results))

    # Writing.
    stream = io.BytesIO()
    writer = info.streamwriter(stream)
    sizes = []
    for c in text:
        writer.write(c)
        sizes.append(stream.tell())
    before = stream.getvalue()
    writer.reset()
    print('  write', crc(sizes), crc(before), crc(stream.getvalue()), stream.getvalue() == data, before == data)
    stream = io.BytesIO()
    writer = info.streamwriter(stream)
    writer.writelines(text.splitlines(True))
    writer.reset()
    print('  writelines', crc(stream.getvalue()))
    results = []
    for i in range(len(text) // 2 + 1):
        stream = io.BytesIO()
        writer = info.streamwriter(stream)
        writer.write(text[:i])
        first = stream.getvalue()
        writer.reset()
        second = stream.getvalue()
        writer.write(text[i:])
        writer.reset()
        results.append((first, second, stream.getvalue()))
    print('  write reset', crc(results))
    for errors in ('strict', 'ignore', 'replace', 'xmlcharrefreplace', 'backslashreplace'):
        stream = io.BytesIO()
        writer = info.streamwriter(stream, errors)
        results = [outcome(writer.write, piece) for piece in ('a', '\ud800', '\u304b', '\ud800', '\xca', 'b\ud800c', '\u3042\ud800\u3042', '\xe6')] + [outcome(writer.reset)]
        print('  write', errors, results, stream.getvalue())
