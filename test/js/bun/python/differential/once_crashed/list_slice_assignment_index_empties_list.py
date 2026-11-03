# test_xml_etree.BadElementTest.test_ass_subscr_with_mutating_slice: __index__ of a slice bound empties the list that is being assigned to
class X:
    def __init__(self, i=0):
        self.i = i
    def __index__(self):
        l[:] = []
        return self.i
for s in slice(X(), None, None), slice(X(2), None, None), slice(None, X(), None), slice(None, X(2), None), slice(None, None, X(1)), slice(None, None, X(2)), slice(X(-1), None, X(-1)):
    l = list(range(10))
    try:
        l[s] = []
    except ValueError as e:
        print("ValueError", e)
    print(s.start is None, l)
