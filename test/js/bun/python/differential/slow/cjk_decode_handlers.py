# All sequences of two bytes with the same first byte in a row, a line feed after each, with each way of treating errors.
import os, sys
sys.dont_write_bytecode = True
above = os.path.dirname(os.path.abspath(__file__))
while not os.path.isdir(os.path.join(above, 'mod_cjk')): above = os.path.dirname(above)
sys.path.insert(0, os.path.join(above, 'mod_cjk'))
from common import *

seen = []
def note(e):
    seen.append((e.start, e.end, e.reason, e.encoding, len(e.object)))
    return ('[%d]' % e.start, e.end)
def back(e):
    # Goes on in the middle of what was wrong.
    return ('<', e.start + 1)
def skip(e):
    return ('', min(e.end + 1, len(e.object)))
codecs.register_error('test.note', note)
codecs.register_error('test.back', back)
codecs.register_error('test.skip', skip)

rows = [b''.join(bytes([a, b, 10]) for b in range(256)) for a in range(256)]
for name in ALL:
    decode = codecs.lookup(name).decode
    for errors in ('strict', 'ignore', 'replace', 'backslashreplace', 'surrogateescape', 'surrogatepass', 'xmlcharrefreplace', 'namereplace', 'test.note', 'test.back', 'test.skip'):
        print(name, errors, crc(*[outcome(decode, row, errors) for row in rows]), crc(seen))
        seen.clear()
