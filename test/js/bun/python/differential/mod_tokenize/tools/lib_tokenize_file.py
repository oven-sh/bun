# Prints what Lib/tokenize.py makes of each file named on the command line, and checks that untokenize() gives the text back.
import sys, io, tokenize
for path in sys.argv[1:]:
    with open(path, 'rb') as f:
        data = f.read()
    try:
        toks = list(tokenize.tokenize(io.BytesIO(data).readline))
    except (tokenize.TokenError, SyntaxError) as e:
        print(type(e).__name__, e)
        continue
    last = None
    for t in toks:
        print(t.type, tokenize.tok_name[t.exact_type], ascii(t.string), t.start, t.end, ascii(t.line) if t.line != last else '=')
        last = t.line
    back = tokenize.untokenize(toks)
    print(len(back), back == data)
