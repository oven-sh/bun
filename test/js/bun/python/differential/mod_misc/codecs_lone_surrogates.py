# What is left of test_codecs' tests of lone surrogates when the texts with a lead directly before a trail are left out.
import codecs
def show(f):
    try:
        r = f()
        print(ascii(r))
    except Exception as e:
        print(type(e).__name__, ascii(str(e)), getattr(e, 'start', None), getattr(e, 'end', None))
ill = {'utf-8': b'\xed\xb2\x80', 'utf-8-sig': b'\xed\xb2\x80', 'utf-16': b'\x80\xdc', 'utf-16-le': b'\x80\xdc', 'utf-16-be': b'\xdc\x80', 'utf-32': b'\x80\xdc\x00\x00', 'utf-32-le': b'\x80\xdc\x00\x00', 'utf-32-be': b'\x00\x00\xdc\x80'}
for enc in ill:
    print('==', enc)
    show(lambda: '\ud800'.encode(enc))
    for h in ['backslashreplace', 'namereplace', 'xmlcharrefreplace', 'ignore', 'replace', 'surrogatepass', 'surrogateescape', 'strict']:
        show(lambda: '[\udc80]'.encode(enc, h))
        show(lambda: '[\udc80\ud800]'.encode(enc, h))
        show(lambda: '[\ud800]\udc80'.encode(enc, h))
        show(lambda: '\ud800'.encode(enc, h))
    bom = ''.encode(enc)
    for before, after in [('\U00010fff', 'A'), ('[', ']'), ('A', '\U00010fff')]:
        bs, as_ = before.encode(enc)[len(bom):], after.encode(enc)[len(bom):]
        ts = before + '\udc80' + after
        seq = bom + bs + ill[enc] + as_
        show(lambda: seq.decode(enc))
        show(lambda: ts.encode(enc, 'surrogatepass') == seq)
        show(lambda: seq.decode(enc, 'surrogatepass') == ts)
        for h in ['ignore', 'replace', 'backslashreplace']:
            show(lambda: seq.decode(enc, h))
for enc in ['utf-8', 'utf-8-sig']:
    show(lambda: 'abc\ud800def'.encode(enc, 'surrogatepass'))
    show(lambda: '\U00010fff\ud800'.encode(enc, 'surrogatepass'))
    show(lambda: b'abc\xed\xa0\x80def'.decode(enc, 'surrogatepass'))
    show(lambda: b'\xf0\x90\xbf\xbf\xed\xa0\x80'.decode(enc, 'surrogatepass'))
    show(lambda: b'abc\xed\xa0'.decode(enc, 'surrogatepass'))
    show(lambda: b'abc\xed\xa0z'.decode(enc, 'surrogatepass'))
