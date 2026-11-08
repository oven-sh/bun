# A `try` with `except*` clauses gathers what each clause has raised, or None, in a list that the code of the statement makes. gc.get_objects() hands it out to a clause while it runs, and each item was taken for an exception.
import gc
def run(junk, group):
    seen = []
    before = {id(o) for o in gc.get_objects() if type(o) is list}
    try:
        try:
            raise ExceptionGroup('g', [ValueError(1), TypeError(2)]) if group else ValueError(1)
        except* ValueError:
            for o in gc.get_objects():
                if type(o) is list and id(o) not in before and o is not seen and o == []:
                    seen.append(len(o)); o.append(junk)
        except* TypeError:
            pass
    except SystemError as e: return seen, 'SystemError: %s' % e
    return seen, 'no exception'
for group in (True, False):
    for junk in (1, 'junk', (), object(), ValueError):
        print(group, type(junk).__name__, *run(junk, group))
