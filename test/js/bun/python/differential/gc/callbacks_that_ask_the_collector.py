# gc.callbacks that ask the collector for something themselves. The program goes on, "start" and "stop" come in turn, and it is told of no
# collection where CPython has none: get_objects() and get_referrers() collect nothing there.
import gc

class Node:
    pass

phases = []
def allocate():
    # Until the collector has come of itself.
    for i in range(3000000):
        a = [i]
        a.append(a)
        if 'stop' in phases:
            break

def told_while(name, ask, work):
    del phases[:]
    def callback(phase, info):
        phases.append(phase)
        ask()
    gc.callbacks.append(callback)
    try:
        work()
        for i in range(1000):
            pass
    finally:
        gc.callbacks.remove(callback)
    return list(phases)

node = Node()
asks = {
    'nothing': lambda: None,
    'get_objects': lambda: len(gc.get_objects()),
    'get_referrers': lambda: len(gc.get_referrers(node)),
    'get_referents': lambda: len(gc.get_referents(node)),
    'collect': gc.collect,
    'get_stats': gc.get_stats,
    'garbage of its own': lambda: [Node() for i in range(100)],
}
for name, ask in asks.items():
    # How often it collects is the collector's business.
    told = told_while(name, ask, allocate)
    print('the callback asks for', name, '| allocation: told', bool(told), '| in turn', told == ['start', 'stop'] * (len(told) // 2))
    print('the callback asks for', name, '| gc.collect():', told_while(name, ask, gc.collect))

gc.collect()
for name, ask in asks.items():
    for work_name in 'get_objects', 'get_referrers', 'get_referents':
        print('the callback asks for', name, '|', work_name + '():', told_while(name, ask, asks[work_name]))

gc.collect()
before = gc.get_stats()
len(gc.get_objects()); len(gc.get_referrers(node)); len(gc.get_referents(node))
print('in the statistics:', [now['collections'] - then['collections'] for now, then in zip(gc.get_stats(), before)])
