# Whether CPython's collector keeps track of a tuple goes by its items, and an item that is a tuple is asked the same. There the answer is a bit of the tuple. Whoever works it out has to do so for tuples in tuples 200,000
# deep, and for a tuple that is an item of the next twice over, forty levels up (2 ** 40 ways down): without recursion, and asking each tuple once. And what has to be done for a great tuple is done once: not once for each
# tuple that holds it, nor once for each reference that it holds.
import gc, signal
def deep(n, bottom):
    t = bottom
    for i in range(n): t = (t,)
    return t
def wide(n, bottom):
    t = bottom
    for i in range(n): t = (t, t)
    return t
among = lambda o, objects: any(r is o for r in objects)
# Each line is written out at once: a look that does not come to an end ends the process, and what has been said by then tells which look it was.
def say(*words): print(*words, flush=True)
# A look that has to be linear is made under an alarm that goes by the processor time of the process and has no handler. It takes a fraction of a second; a form that goes through a great tuple once for each tuple that
# holds it, or once for each reference that it holds, would take minutes: the process is ended, whatever else the machine is doing.
def within(seconds, function):
    alarm = getattr(signal, 'setitimer', None)
    if alarm: alarm(signal.ITIMER_PROF, seconds)
    try: return function()
    finally:
        if alarm: alarm(signal.ITIMER_PROF, 0)
# ONE THING AT A TIME, AND EACH ONLY FOR THE LOOKS THAT IT IS THERE FOR: on a slow build this test's time is what the 200,000 cost, in every look that is made while they are there.
# (With nothing at the bottom that is kept track of, what CPython says of the top goes by how many collections have come, and in which order they met the tuples: not compared.)
say('200,000 deep, nothing that is kept track of at the bottom')
t = deep(200000, (1, 'a')); say('   there is an answer: %s' % (gc.is_tracked(t) in (True, False))); del t
say('200,000 deep, a list at the bottom')
t = deep(200000, ([],)); say('   kept track of: %s' % gc.is_tracked(t)); say('   among all objects: %s' % within(40, lambda: among(t, gc.get_objects()))); del t
for name, bottom in (('nothing that is kept track of', (1, 'a')), ('a list', ([],))):
    say('forty levels, each an item of the next twice over, %s at the bottom' % name)
    t = wide(40, bottom); answers = within(40, lambda: (gc.is_tracked(t), among(t, gc.get_objects()), gc.get_referrers(t[0])))
    say('   there are answers' if bottom[0] == 1 else '   kept track of: %s; among all objects: %s; the referrers of its item: %d, it among them: %s' % (answers[0], answers[1], len(answers[2]), among(t, answers[2])))
    del t, answers
say('30,000 tuples share one tuple of 3,000,000 numbers')
big = (0,) * 3000000; rows = [(i, big) for i in range(30000)]
# An item that is a short tuple of numbers may be looked at on the spot, a longer one by way of a table. (This pins the answers on both sides of such a line, wherever it is drawn: not the line.)
edge = {n: ((tuple(range(n)), 1), (tuple(range(n - 1)) + ([],), 1)) for n in (1, 7, 8, 9, 10)}
gc.collect(); gc.collect(); gc.collect()
say('   kept track of: %s, %s' % (gc.is_tracked(rows[0]), gc.is_tracked(big)))
say('   among all objects: %d' % within(40, lambda: sum(type(o) is tuple and len(o) == 2 and o[1] is big for o in gc.get_objects())))
say('   among the referrers of what they share: %d' % within(40, lambda: sum(type(o) is tuple for o in gc.get_referrers(big))))
del big, rows
say('an item of 1, 7, 8, 9, 10 numbers: kept track of:', [gc.is_tracked(edge[n][0]) for n in edge], '| with a list in the place of the last:', [gc.is_tracked(edge[n][1]) for n in edge])
del edge
say('one tuple holds one object 500,000 times')
class X: pass
x = X(); many = (x,) * 500000
say('   among the referrers of the object: %d time(s)' % within(40, lambda: sum(o is many for o in gc.get_referrers(x))))
