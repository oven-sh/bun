# While C++ holds a buffer of memory that belongs to JS, and there are threads, JS cannot take the memory away.
import js, os, threading

class Buffers:
    # os.readv() takes the buffer of each item in turn: while it asks for the second, it holds the first.
    def __init__(self, first, between):
        self.items, self.between = [first, bytearray(1)], between
    def __len__(self): return 2
    def __getitem__(self, i):
        if i == 1: self.between()
        return self.items[i]

def read_into(target, meanwhile):
    r, w = os.pipe()
    held, go_on, out = threading.Event(), threading.Event(), []
    def between(): held.set(); go_on.wait()
    t = threading.Thread(target=lambda: out.append(os.readv(r, Buffers(target, between))))
    t.start(); held.wait()
    result = meanwhile()
    go_on.set(); os.write(w, b"abcdefghi"); t.join()
    os.close(r); os.close(w)
    return out, result

small = js.Uint8Array.new(8)                       # Its memory is in the heap of JS, until somebody asks for an ArrayBuffer.
out, copy = read_into(small, lambda: small.buffer.transfer())
print(out, bytes(small), small.buffer.detached, copy.byteLength)

large = js.Uint8Array.new(100000)
out, copy = read_into(large, lambda: js.structuredClone(large.buffer, js.eval("(b) => ({ transfer: [b] })")(large.buffer)))
print(out, bytes(large)[:9], large.buffer.detached, copy.byteLength)

resizable = js.eval("new ArrayBuffer(8, { maxByteLength: 16 })")
def shrink():
    try:
        resizable.resize(4)
    except Exception as e:
        return str(e)
out, error = read_into(resizable, shrink)
print(out, bytes(resizable), error)
out, _ = read_into(resizable, lambda: resizable.resize(16))
print(out, bytes(resizable))

# Afterwards it is as free as before.
resizable.resize(4); print(resizable.byteLength)
moved = small.buffer.transfer(); print(small.buffer.detached, len(bytes(moved)))
