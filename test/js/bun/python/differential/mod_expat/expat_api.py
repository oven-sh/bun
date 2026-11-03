import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from expat_common import *
import io, gc, weakref

def show(f, *a, **k):
    try:
        r = f(*a, **k)
        print(ascii(r))
    except BaseException as e:
        print(type(e).__name__, ascii(str(e)), getattr(e, '__notes__', None))

print(sorted(n for n in dir(pyexpat) if not n.startswith('__') and n != 'expat_CAPI'))
p = expat.ParserCreate()
print(sorted(n for n in dir(p) if not n.startswith('__')))
print(pyexpat.EXPAT_VERSION, pyexpat.version_info, pyexpat.native_encoding, pyexpat.features)
print(pyexpat.ExpatError, pyexpat.ExpatError.__mro__, pyexpat.error is pyexpat.ExpatError, pyexpat.XMLParserType, type(p), pyexpat.__doc__, type(p).__doc__)
print(pyexpat.errors.__name__, pyexpat.model.__name__, pyexpat.errors.__doc__, pyexpat.model.__doc__, expat.errors is pyexpat.errors, sys.modules['xml.parsers.expat.errors'] is pyexpat.errors, sys.modules['pyexpat.model'] is pyexpat.model)
print(sorted((k, v) for k, v in vars(pyexpat.model).items() if k.startswith('XML')))
print(sorted((k, v) for k, v in vars(pyexpat.errors).items() if k.startswith('XML')))
print(pyexpat.errors.codes == {v: k for k, v in pyexpat.errors.messages.items()}, sorted(pyexpat.errors.messages.items()))
for c in (-1, 0, 1, 2, 44, 45, 1000): show(expat.ErrorString, c)
show(expat.ErrorString); show(expat.ErrorString, 'a'); show(expat.ErrorString, 1.5); show(expat.ErrorString, 2**70)
for n in ('buffer_size', 'buffer_text', 'buffer_used', 'namespace_prefixes', 'ordered_attributes', 'specified_attributes', 'intern', 'ErrorCode', 'ErrorLineNumber', 'ErrorColumnNumber', 'ErrorByteIndex', 'CurrentLineNumber', 'CurrentColumnNumber', 'CurrentByteIndex', 'StartElementHandler', 'DefaultHandlerExpand'):
    print(n, repr(getattr(p, n)), type(type(p).__dict__[n]).__name__)
show(pyexpat.XMLParserType); show(setattr, p, 'foo', 1); show(lambda: p.foo); show(setattr, type(p), 'x', 1)

# ParserCreate
PC = expat.ParserCreate
show(lambda: type(PC(None, None, None))); show(PC, 1); show(PC, b'x'); show(PC, None, 1); show(PC, None, 'ab'); show(PC, None, '\U0001f600'); show(PC, None, 'é' ) if False else None
show(PC, None, None, 1); show(PC, None, None, []); show(lambda: PC(intern=None).intern); show(lambda: PC(intern={}).intern); show(lambda: PC().intern); show(PC, 'a\0b'); show(PC, None, '\0'); show(PC, 1, 2, 3, 4); show(PC, foo=1)
show(lambda: type(PC(encoding='utf-8', namespace_separator=' ', intern={})))
d = {}; q = PC(intern=d); print(q.intern is d); q.StartElementHandler = lambda n, a: None; q.Parse('<abc de="f"><abc/></abc>', True); print(sorted(d))
show(setattr, q, 'intern', {}); show(delattr, q, 'intern')
class D(dict): pass
show(lambda: type(PC(intern=D()).intern))

# Attributes
p = PC()
for n in ('buffer_text', 'namespace_prefixes', 'ordered_attributes', 'specified_attributes'):
    for v in (1, 0, 'x', '', [], [0], None, True):
        setattr(p, n, v); print(n, repr(v), getattr(p, n))
    show(delattr, p, n)
class BadBool:
    def __bool__(self): raise KeyError('bool')
show(setattr, p, 'buffer_text', BadBool()); show(setattr, p, 'ordered_attributes', BadBool())
for v in (1, 100, 2**31 - 1, 2**31, 0, -1, 'a', 1.5, None, True, 2**70):
    show(setattr, p, 'buffer_size', v); print(p.buffer_size, p.buffer_text)
show(delattr, p, 'buffer_size'); show(setattr, p, 'buffer_used', 1); show(setattr, p, 'ErrorCode', 1); show(setattr, p, 'CurrentLineNumber', 1); show(delattr, p, 'ErrorCode')
for n in HANDLERS + ['DefaultHandler', 'DefaultHandlerExpand']:
    f = lambda *a: None
    setattr(p, n, f); assert getattr(p, n) is f; setattr(p, n, None); assert getattr(p, n) is None
show(delattr, p, 'StartElementHandler'); p.StartElementHandler = 5; show(p.Parse, '<a/>'); print(p.StartElementHandler)

# Parse
p = PC(); show(p.Parse); show(p.Parse, 1); show(p.Parse, None); show(p.Parse, '<a/>', 1, 2); show(p.Parse, data='<a/>'); show(p.Parse, '<a/>', isfinal=1); show(p.Parse, [60]); show(p.Parse, '\ud800')
for data in ('<a/>', b'<a/>', bytearray(b'<a/>'), memoryview(b'<a/>'), memoryview(b'x<a/>')[1:]):
    show(PC().Parse, data, True)
show(PC().Parse, '<a/>', BadBool())
p = PC(); print(p.Parse('<a>'), p.Parse('', 0), p.Parse(b''), p.Parse('</a>', 1)); show(p.Parse, '', True); show(p.Parse, '<b/>'); print(p.ErrorCode)
p = PC(); show(p.Parse, '<a></b>', True); show(p.Parse, '<a/>', True); show(p.Parse, '', True); print(p.ErrorCode, p.ErrorLineNumber, p.ErrorColumnNumber, p.ErrorByteIndex)
p = PC(); show(p.Parse, '', True); p = PC(); show(p.Parse, b'', False); show(p.Parse, b'', True)
e = None
try: PC().Parse('<a>\n <b></c>', True)
except expat.ExpatError as ex: e = ex
print(type(e), e.args, e.code, e.lineno, e.offset, sorted(e.__dict__), expat.ErrorString(e.code))

# ParseFile
show(PC().ParseFile); show(PC().ParseFile, 1); show(PC().ParseFile, io.BytesIO(b'<a/>')); show(PC().ParseFile, io.BytesIO(b'')); show(PC().ParseFile, io.BytesIO(b'<a>')); show(PC().ParseFile, io.StringIO('<a/>')); show(PC().ParseFile, file=io.BytesIO(b'<a/>'))
class F:
    def __init__(self, *chunks): self.chunks = list(chunks); self.sizes = []
    def read(self, n):
        self.sizes.append(n)
        return self.chunks.pop(0) if self.chunks else b''
f = F(b'<a>', bytearray(b'x'), b'</a>'); show(PC().ParseFile, f); print(f.sizes)
show(PC().ParseFile, F(b'x' * 3000)); show(PC().ParseFile, F(None)); show(PC().ParseFile, F(memoryview(b'<a/>'))); show(PC().ParseFile, F('<a/>'))
class FE:
    def read(self, n): raise OSError('rd')
show(PC().ParseFile, FE())
big = b'<a>' + b'<b c="d">text</b>' * 1000 + b'</a>'
n = []; p = PC(); p.StartElementHandler = lambda *a: n.append(1); show(p.ParseFile, io.BytesIO(big)); print(len(n), p.CurrentByteIndex, p.CurrentLineNumber, p.CurrentColumnNumber)

# Exceptions in handlers
def boom(*a): raise KeyError('boom')
for h, doc in [('StartElementHandler', '<a/>'), ('EndElementHandler', '<a/>'), ('CharacterDataHandler', '<a>x</a>'), ('CommentHandler', '<a><!--c--></a>'), ('ProcessingInstructionHandler', '<?p?><a/>'), ('DefaultHandler', '<a/>'), ('DefaultHandlerExpand', '<a/>'), ('XmlDeclHandler', '<?xml version="1.0"?><a/>'),
               ('StartDoctypeDeclHandler', '<!DOCTYPE a><a/>'), ('EndDoctypeDeclHandler', '<!DOCTYPE a><a/>'), ('EntityDeclHandler', '<!DOCTYPE a [<!ENTITY e "v">]><a/>'), ('ElementDeclHandler', '<!DOCTYPE a [<!ELEMENT a (b)>]><a/>'), ('AttlistDeclHandler', '<!DOCTYPE a [<!ATTLIST a b CDATA "c">]><a/>'),
               ('NotationDeclHandler', '<!DOCTYPE a [<!NOTATION n SYSTEM "s">]><a/>'), ('StartCdataSectionHandler', '<a><![CDATA[x]]></a>'), ('EndCdataSectionHandler', '<a><![CDATA[x]]></a>'), ('NotStandaloneHandler', '<!DOCTYPE a SYSTEM "s"><a/>'), ('ExternalEntityRefHandler', '<!DOCTYPE a [<!ENTITY e SYSTEM "s">]><a>&e;</a>'),
               ('SkippedEntityHandler', '<!DOCTYPE a SYSTEM "s"><a>&e;</a>')]:
    p = PC(); seen = []
    p.StartElementHandler = lambda *a: seen.append(a); p.EndElementHandler = lambda *a: seen.append(a)
    setattr(p, h, boom)
    show(p.Parse, doc, True); print(h, seen, p.ErrorCode, p.StartElementHandler is None, getattr(p, h) is None, p.CurrentLineNumber, p.CurrentColumnNumber, p.CurrentByteIndex); show(p.Parse, '', True)
p = PC(namespace_separator=' '); p.StartNamespaceDeclHandler = boom; show(p.Parse, '<a xmlns="u"/>', True)
p = PC(namespace_separator=' '); p.EndNamespaceDeclHandler = boom; show(p.Parse, '<a xmlns="u"/>', True)
p = PC(); p.buffer_text = True; p.CharacterDataHandler = boom; show(p.Parse, '<a>x', False); show(p.Parse, 'y</a>', True)
for rv in (0, 1, None, 'x', 2**70, 1.5, True, False, -1):
    p = PC(); p.NotStandaloneHandler = lambda rv=rv: rv; show(p.Parse, '<!DOCTYPE a SYSTEM "s"><a/>', True)
    p = PC(); p.ExternalEntityRefHandler = lambda *a, rv=rv: rv; show(p.Parse, '<!DOCTYPE a [<!ENTITY e SYSTEM "s">]><a>&e;</a>', True)

# From within a handler
p = PC()
def h(name, attrs):
    show(p.Parse, '<x/>'); show(p.ParseFile, io.BytesIO(b'')); show(p.GetInputContext); print(p.CurrentByteIndex, p.buffer_used)
p.StartElementHandler = h; print(p.GetInputContext()); p.Parse(b'<a><b c="d"/>tail', False); print(p.GetInputContext()); p.Parse(b'</a>', True)
p = PC(); ctx = []
for n in ('CharacterDataHandler', 'EndElementHandler', 'CommentHandler'): setattr(p, n, lambda *a: ctx.append(p.GetInputContext()))
p.Parse('<a>xé<!--c-->&amp;y</a>\n'.encode(), True); print(ctx)
p = PC(); out = []
def start(name, attrs):
    out.append(name)
    if name == 'b': p.StartElementHandler = None; p.CharacterDataHandler = lambda d: out.append(d)
p.StartElementHandler = start; p.Parse('<a>1<b>2<c>3</c></b></a>', True); print(out)

# buffer_text
def chunks(doc, **attrs):
    p = PC(); out = []
    p.CharacterDataHandler = lambda d: out.append((d, p.buffer_used)); p.StartElementHandler = lambda n, a: out.append('<' + n); p.EndElementHandler = lambda n: out.append('>' + n); p.CommentHandler = lambda c: out.append('!' + c)
    for k, v in attrs.items(): setattr(p, k, v)
    for part in doc if isinstance(doc, list) else [doc]:
        p.Parse(part, False); out.append(('used', p.buffer_used))
    p.Parse('', True); print(ascii(out))
for doc in ('<a>1\n2&amp;3<b/>4<!--c-->5&#65;6</a>', ['<a>12', '34', '</a>'], '<a>' + 'x' * 30 + '</a>', '<a>' + 'é' * 10 + '\n' + '\U0001f600' * 5 + '</a>', '<a>' + 'ab\n' * 10 + '</a>'):
    chunks(doc); chunks(doc, buffer_text=True); chunks(doc, buffer_text=True, buffer_size=4); chunks(doc, buffer_size=10); chunks(doc, buffer_text=True, buffer_size=1)
p = PC(); out = []; p.buffer_text = True; p.CharacterDataHandler = out.append; p.Parse('<a>abc', False); print(out, p.buffer_used); p.buffer_text = False; print(out, p.buffer_used, p.buffer_text)
p = PC(); out = []; p.buffer_text = True; p.CharacterDataHandler = out.append; p.Parse('<a>abc', False); p.buffer_size = 100; print(out, p.buffer_used); p.Parse('def', False); p.CharacterDataHandler = None; print(out, p.buffer_used)
p = PC(); out = []; p.buffer_text = True; p.CharacterDataHandler = out.append; p.Parse('<a>abc', False); p.buffer_text = True; print(out, p.buffer_used)

# Base, misc methods
p = PC(); print(p.GetBase()); show(p.SetBase, 'b'); print(p.GetBase()); show(p.SetBase, 1); show(p.SetBase, None); show(p.SetBase, 'a\0'); show(p.SetBase); show(p.GetBase, 1); show(p.GetInputContext, 1)
print(p.SetParamEntityParsing(0), p.SetParamEntityParsing(1), p.SetParamEntityParsing(2), p.SetParamEntityParsing(5)); show(p.SetParamEntityParsing, 'a'); show(p.SetParamEntityParsing); show(p.UseForeignDTD); show(p.UseForeignDTD, 0); show(p.UseForeignDTD, 1, 2)
p.Parse('<a>'); print(p.SetParamEntityParsing(1)); show(p.UseForeignDTD); show(p.UseForeignDTD, False)
p = PC(); print(p.GetReparseDeferralEnabled()); show(p.SetReparseDeferralEnabled, False); print(p.GetReparseDeferralEnabled()); show(p.SetReparseDeferralEnabled, 'x'); print(p.GetReparseDeferralEnabled()); show(p.SetReparseDeferralEnabled); show(p.GetReparseDeferralEnabled, 1)
for enabled in (True, False):
    for parts in ([b'<doc', b'/>'], [b'<a>', b'<b', b' c="d"', b'>', b'x', b'</b>', b'</a>'], [b'<', b'a', b'>', b'<', b'/', b'a', b'>'], [b'<a>' + b'x' * 10, b'<b' + b' ' * 20, b'/>', b'</a>']):
        p = PC(); p.SetReparseDeferralEnabled(enabled); ev = []
        p.StartElementHandler = lambda n, a: ev.append('<' + n); p.EndElementHandler = lambda n: ev.append('>' + n); p.CharacterDataHandler = lambda d: ev.append(d)
        for part in parts: p.Parse(part, False); ev.append('|')
        p.Parse(b'', True); print(enabled, ev)
for m in ('SetBillionLaughsAttackProtectionActivationThreshold', 'SetAllocTrackerActivationThreshold'):
    for v in (0, 1, 2**64 - 1, 2**64, -1, 'a', 1.5): show(getattr(PC(), m), v)
for m in ('SetBillionLaughsAttackProtectionMaximumAmplification', 'SetAllocTrackerMaximumAmplification'):
    for v in (1, 1.0, 100.5, 0.99, 0, -1, float('nan'), float('inf'), 'a'): show(getattr(PC(), m), v)

# Default handlers: which of the two counts
doc = '<!DOCTYPE a [<!ENTITY e "v">]><a>&e;</a>'
def which(*steps):
    p = PC(); out = []
    for name, tag in steps: setattr(p, name, (lambda t: (lambda d: out.append((t, d))))(tag) if tag else None)
    p.Parse(doc, True); print(out[-4:])
which(('DefaultHandler', 'D')); which(('DefaultHandlerExpand', 'X')); which(('DefaultHandler', 'D'), ('DefaultHandlerExpand', 'X')); which(('DefaultHandlerExpand', 'X'), ('DefaultHandler', 'D')); which(('DefaultHandler', 'D'), ('DefaultHandlerExpand', 'X'), ('DefaultHandlerExpand', None))
which(('DefaultHandler', 'D'), ('DefaultHandler', None)); which(('DefaultHandlerExpand', 'X'), ('DefaultHandler', None))
p = PC(); out = []; p.DefaultHandler = None; p.CharacterDataHandler = out.append; p.Parse(doc, True); print(out)
p = PC(); out = []; p.CharacterDataHandler = out.append; p.Parse(doc, True); print(out)
p = PC(); out = []; p.DefaultHandler = lambda d: None; p.SkippedEntityHandler = lambda *a: out.append(a); p.Parse(doc, True); print(out)

# The parser goes away
p = PC(); p.StartElementHandler = lambda *a: p; del p; gc.collect()

# Billion laughs
laughs = '<!DOCTYPE a [<!ENTITY a0 "' + 'ha' * 50 + '">' + ''.join('<!ENTITY a%d "%s">' % (i, ('&a%d;' % (i - 1)) * 10) for i in range(1, 9)) + ']><a>&a8;</a>'
p = PC(); n = [0]
def count(d): n[0] += len(d)
p.CharacterDataHandler = count
try: p.Parse(laughs, True); print('parsed')
except expat.ExpatError as e: print('ExpatError', e.code, expat.ErrorString(e.code))
