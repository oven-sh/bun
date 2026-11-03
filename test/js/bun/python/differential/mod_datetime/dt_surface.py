import sys, inspect, types
import datetime, _datetime
from datetime import timedelta, date, time, timezone, tzinfo
dt = datetime.datetime

def t(src, **env):
    try:
        print(src, '=>', repr(eval(src, globals(), env)))
    except BaseException as e:
        print(src, '!!', type(e).__name__, e)
def block(text, **env):
    for src in text.strip().splitlines():
        t(src, **env)

print('--- the module')
block('''
sorted(n for n in dir(_datetime) if n != 'datetime_CAPI')
sorted(datetime.__all__)
_datetime.__name__, _datetime.__doc__
datetime.date is _datetime.date, datetime.datetime is _datetime.datetime, datetime.time is _datetime.time, datetime.timedelta is _datetime.timedelta, datetime.tzinfo is _datetime.tzinfo, datetime.timezone is _datetime.timezone, datetime.UTC is _datetime.UTC
_datetime.MINYEAR, _datetime.MAXYEAR
'_pydatetime' in sys.modules
type(_datetime).__name__
''')
kinds = {}
for cls in [timedelta, date, dt, time, tzinfo, timezone, type(date(2020, 1, 1).isocalendar())]:
    print('---', cls)
    print(cls.__name__, cls.__qualname__, cls.__module__, cls.__bases__, cls.__mro__, type(cls), cls.__dictoffset__ == 0, cls.__weakrefoffset__ == 0, cls.__itemsize__)
    print(repr(cls.__doc__))
    print(repr(getattr(cls, '__text_signature__', 'none')))
    for flag, name in [(1 << 8, 'IMMUTABLETYPE'), (1 << 10, 'BASETYPE'), (1 << 7, 'DISALLOW_INSTANTIATION'), (1 << 14, 'HAVE_GC')]:
        if name != 'HAVE_GC':
            print('   ', name, bool(cls.__flags__ & flag))
    for name in sorted(vars(cls)):
        value = vars(cls)[name]
        line = [name, type(value).__name__]
        if name not in ('__doc__',):
            line.append(repr(getattr(value, '__doc__', None)) if type(value).__name__ not in ('timedelta', 'date', 'datetime', 'time', 'timezone', 'str', 'NoneType') else repr(value))
            line.append(repr(getattr(value, '__text_signature__', None)) if type(value).__name__ in ('method_descriptor', 'classmethod_descriptor', 'builtin_function_or_method', 'wrapper_descriptor') else '')
            line.append(repr(getattr(value, '__qualname__', None)))
            line.append(repr(getattr(value, '__objclass__', None)))
        print('   ', *line)
    try:
        print('    signature', inspect.signature(cls))
    except (ValueError, TypeError) as e:
        print('    signature', type(e).__name__, e)
    try:
        cls.foo = 1
        print('    attribute set')
    except TypeError as e:
        print('    TypeError', e)
    try:
        del cls.__repr__
    except (TypeError, AttributeError) as e:
        print('   ', type(e).__name__, e)
print('--- signatures of the methods')
for cls in [timedelta, date, dt, time, tzinfo, timezone]:
    for name in sorted(dir(cls)):
        if name.startswith('__') and name not in ('__format__', '__reduce__', '__reduce_ex__', '__replace__', '__getinitargs__'):
            continue
        f = getattr(cls, name)
        if not callable(f):
            continue
        try:
            print(cls.__name__, name, inspect.signature(f))
        except (ValueError, TypeError) as e:
            print(cls.__name__, name, type(e).__name__)
print('--- bound and unbound')
d = date(2020, 1, 2)
block('''
repr(d.isoformat)[:45]
repr(date.isoformat)
repr(date.today)[:40]
repr(date.__add__)
repr(d.__add__)[:40]
repr(date.__new__)[:40]
repr(date.year)
repr(timedelta.days)
date.isoformat.__name__, date.isoformat.__qualname__, date.isoformat.__objclass__
date.today.__name__, date.today.__qualname__, date.today.__self__
d.isoformat.__self__ is d, d.isoformat.__name__, d.isoformat.__qualname__
date.__dict__['today'].__objclass__
dt.now.__self__, dt.fromtimestamp.__qualname__
isinstance(date.isoformat, types.MethodDescriptorType), isinstance(date.__dict__['today'], types.ClassMethodDescriptorType), isinstance(date.year, types.GetSetDescriptorType), isinstance(timedelta.days, types.MemberDescriptorType), isinstance(date.__add__, types.WrapperDescriptorType)
date.isoformat.__get__(d)()
date.isoformat.__get__(1)
date.isoformat.__get__(None, date) is date.isoformat
date.__dict__['today'].__get__(None, date)().__class__
date.__dict__['today'].__get__(None, int)
date.__dict__['today'].__get__(d)().__class__
date.__hash__ is not None, timedelta.__hash__ is not None, tzinfo.__hash__ is object.__hash__
dt.__hash__ is date.__hash__, dt.__eq__ is date.__eq__, dt.strftime is date.strftime, dt.__format__ is date.__format__, dt.weekday is date.weekday
timezone.__reduce__ is tzinfo.__reduce__, 'fromutc' in vars(timezone)
date.__init__ is object.__init__, date.__getattribute__ is object.__getattribute__
date.__new__ is dt.__new__
sys.getsizeof(d) > 0
isinstance(d, object), type(d) is date
dir(d) == dir(date)
d.__class__
d.__doc__ == date.__doc__
d.__init__(), d.__init__(1, 2, 3)
d.__sizeof__() > 0
d.__dir__() is not None
d.__reduce_ex__(2)
d.__getstate__()
d.__ne__(d), d.__eq__(d)
''')
try:
    d.__class__ = dt
except TypeError as e:
    print('TypeError', e)
class D(date): pass
class D2(date): pass
x = D(2020, 1, 2)
try:
    x.__class__ = D2
    print(type(x).__name__, x)
except TypeError as e:
    print('TypeError', e)
try:
    x.__class__ = date
    print(type(x).__name__, x)
except TypeError as e:
    print('TypeError', e)
for bases in [(date, time), (date, timedelta), (dt, date), (date, dt), (tzinfo, date), (date, int), (date, dict), (timedelta, tuple), (tzinfo, dict), (date, object)]:
    try:
        c = type('M', bases, {})
        print([b.__name__ for b in bases], 'ok', [k.__name__ for k in c.__mro__])
    except TypeError as e:
        print([b.__name__ for b in bases], 'TypeError', e)
