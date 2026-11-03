# Programs written in these encodings.
import ast, importlib, io, os, re, subprocess, sys, tempfile, tokenize
sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import *

body = '''# -*- coding: %s -*-
# %s
text = "%s"
def f():
    """%s"""
    return [ord(c) for c in text]
%s = len(text)
print(ascii(text), f(), ascii(f.__doc__), %s)
'''
words = {'cn': '\u4e2d\u6587', 'hk': '\u4e2d\u6587\u5afa', 'tw': '\u4e2d\u6587', 'kr': '\ud55c\uae00', 'jp': '\u65e5\u672c\u8a9e\u8868', 'jp2004': '\u65e5\u672c\u8a9e\u304b\u309a', 'iso2022': None}
with tempfile.TemporaryDirectory() as directory:
    sys.path.insert(0, directory)
    sys.dont_write_bytecode = True
    for group, names in GROUPS.items():
        for name in names:
            word = words[group] or ('\ud55c\uae00' if name == 'iso2022_kr' else '\u65e5\u672c\u8a9e')
            source = (body % (name, word, word, word, word, word)).encode(name)
            print(name, crc(source))
            # compile() of bytes
            try:
                exec(compile(source, '<%s>' % name, 'exec'), {})
            except Exception as e:
                print('  compile', type(e).__name__, e)
            print('  detect', outcome(lambda: tokenize.detect_encoding(io.BytesIO(source).readline)[0]))
            print('  tokens', outcome(lambda: crc([(t.type, t.string, t.start, t.end) for t in tokenize.tokenize(io.BytesIO(source).readline)])))
            print('  ast', outcome(lambda: crc(ast.dump(ast.parse(source)))))
            # A module, and a program.
            path = os.path.join(directory, 'in_%s.py' % name)
            with open(path, 'wb') as f:
                f.write(source)
            try:
                module = importlib.import_module('in_' + name)
                print('  module', ascii(module.text))
            except Exception as e:
                print('  import', type(e).__name__, e)
            with tokenize.open(path) as f:
                print('  open', f.encoding, crc(f.read()))
            if name == names[0] or name == 'iso2022_kr':
                result = subprocess.run([sys.executable, path], capture_output=True)
                print('  run', result.returncode, result.stdout, result.stderr.splitlines()[-1:])

    # What is wrong in such a file, and where.
    for name, bad in (('shift_jis', b'\x81'), ('euc_jp', b'\xa4'), ('gbk', b'\xff\xff'), ('big5', b'\xa4'), ('euc_kr', b'\xc7'), ('iso2022_jp', b'\x1b$B!'), ('cp932', b'\xfc\xfd')):
        source = b'# coding: ' + name.encode() + b'\nx = 1\ny = "' + bad + b'"\n'
        try:
            compile(source, '<bad>', 'exec')
            print(name, 'compiled')
        except SyntaxError as e:
            print(name, type(e).__name__, e.msg, e.lineno, e.offset)
        except Exception as e:
            print(name, type(e).__name__, e)
        path = os.path.join(directory, 'bad_%s.py' % name)
        with open(path, 'wb') as f:
            f.write(source)
        if name not in ('shift_jis', 'gbk'):
            continue
        result = subprocess.run([sys.executable, path], capture_output=True)
        # (Read from a file, the position counts from somewhere in the file.)
        print('  run', result.returncode, result.stdout, [re.sub(rb'position \d+', b'position N', line.replace(directory.encode(), b'DIR')) for line in result.stderr.splitlines()[-2:]])

    # An error in a line with wide characters: the traceback shows the line.
    source = '# coding: shift_jis\ndef f():\n    return "\u65e5\u672c\u8a9e" + 1  # \u8868\n\nf()\n'.encode('shift_jis')
    path = os.path.join(directory, 'failing.py')
    with open(path, 'wb') as f:
        f.write(source)
    result = subprocess.run([sys.executable, '-X', 'utf8', path], capture_output=True)
    print(result.returncode, [line.replace(directory.encode(), b'DIR') for line in result.stderr.splitlines()])
