# Stream readers and writers over streams that misbehave.
import io, os, sys
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

# A stream that fails.
class Failing:
    def read(self, *args): raise OSError('no read')
    def readline(self, *args): raise KeyError('no readline')
    def write(self, data): raise ValueError('no write %r' % data)
info = codecs.lookup('euc_jis_2004')
reader, writer = info.streamreader(Failing()), info.streamwriter(Failing())
print(outcome(reader.read), outcome(reader.read, 1), outcome(reader.readline), outcome(reader.readlines), outcome(writer.write, 'a'), outcome(writer.write, '\u304b'), outcome(writer.reset), outcome(writer.reset), outcome(writer.writelines, ['a']))

# The reader is used from within the stream it reads.
class Nested:
    def __init__(self): self.depth = 0
    def read(self, *args):
        self.depth += 1
        if self.depth == 1:
            print('inner', ascii(self.reader.read(1)))
            return b'\xa2'
        return b'\xa4' if self.depth == 2 else b'\xa4\xa4' if self.depth == 3 else b''
stream = Nested()
stream.reader = codecs.lookup('euc_jp').streamreader(stream)
print(ascii(stream.reader.read(1)), ascii(stream.reader.read()))
