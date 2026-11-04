# A handler on the line of what raised the exception: the line is not told of again.
import sys
ev=[]
def tr(f,e,a):
    if f.f_code.co_filename==__file__ and f.f_code.co_name.startswith('t_'):
        ev.append((e,f.f_lineno-f.f_code.co_firstlineno))
    return tr
class S:
    def __enter__(self): return self
    def __exit__(self,*a): return True
def boom(): raise ValueError
def t_a():
    with S(): boom()
    x = 1
def t_b():
    with S(): pass
    x = 1
def t_c():
    for i in range(2):
        with S(): boom()
def t_d():
    with S() as s: boom()
def t_e():
    try: boom()
    except ValueError: pass
def t_f():
    try: boom()
    finally: return 1
def t_g():
    with S():
        boom()
    x = 1
def t_h():
    with S(), S(): boom()
def t_i():
    try: boom()
    except (ValueError,
            TypeError): pass
for f in (t_a,t_b,t_c,t_d,t_e,t_f,t_g,t_h,t_i):
    sys.settrace(tr); f(); sys.settrace(None)
    print(f.__name__, ev); del ev[:]
m=sys.monitoring
m.use_tool_id(1,'x')
m.register_callback(1,m.events.LINE,lambda c,l: ev.append(l-c.co_firstlineno) if c.co_name.startswith('t_') else None)
for f in (t_a,t_b,t_c,t_d,t_e,t_f,t_g,t_h,t_i):
    m.set_events(1,m.events.LINE); f(); m.set_events(1,0)
    print(f.__name__, ev); del ev[:]
