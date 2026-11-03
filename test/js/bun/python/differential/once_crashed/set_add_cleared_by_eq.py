# the same with nothing but set.add()
class Bad:
    def __eq__(self, other):
        s.clear()
        return False
    def __hash__(self):
        return 0
s = set()
s.add(Bad())
s.add(Bad())
print(len(s))
