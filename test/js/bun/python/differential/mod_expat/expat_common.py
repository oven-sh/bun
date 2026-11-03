import pyexpat, xml.parsers.expat as expat, sys

HANDLERS = ['StartElementHandler', 'EndElementHandler', 'ProcessingInstructionHandler', 'CharacterDataHandler', 'UnparsedEntityDeclHandler', 'NotationDeclHandler',
            'StartNamespaceDeclHandler', 'EndNamespaceDeclHandler', 'CommentHandler', 'StartCdataSectionHandler', 'EndCdataSectionHandler', 'NotStandaloneHandler',
            'ExternalEntityRefHandler', 'StartDoctypeDeclHandler', 'EndDoctypeDeclHandler', 'EntityDeclHandler', 'XmlDeclHandler', 'ElementDeclHandler', 'AttlistDeclHandler', 'SkippedEntityHandler']

def run(data, handlers=HANDLERS, default=None, chunks=None, final=True, positions=False, **kw):
    setup = kw.pop('setup', None)
    p = expat.ParserCreate(**kw)
    out = []
    def make(name):
        def h(*a):
            if positions:
                out.append((name[:-7], a, p.CurrentLineNumber, p.CurrentColumnNumber, p.CurrentByteIndex))
            else:
                out.append((name[:-7],) + a)
            return 1
        return h
    for n in handlers:
        setattr(p, n, make(n))
    if default:
        setattr(p, default, make(default + 'Handler' if not default.endswith('Handler') else default))
    if setup:
        setup(p)
    try:
        if chunks:
            for i in range(0, len(data), chunks):
                p.Parse(data[i:i + chunks], False)
            r = p.Parse(data[:0], True) if final else None
        else:
            r = p.Parse(data, final)
        out.append(('result', r))
    except expat.ExpatError as e:
        out.append(('ExpatError', str(e), e.code, e.lineno, e.offset, p.ErrorCode, p.ErrorLineNumber, p.ErrorColumnNumber, p.ErrorByteIndex))
    except BaseException as e:
        out.append((type(e).__name__, str(e)))
    out.append(('pos', p.CurrentLineNumber, p.CurrentColumnNumber, p.CurrentByteIndex))
    for o in out:
        print(ascii(o))
    print('--')

