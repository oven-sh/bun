# test_set.TestBinaryOpsMutating_*.test_ior_with_mutation (and ixor, update, symmetric_difference_update): __eq__ clears the set that is being added to
class Bad:
    def __eq__(self, other):
        if enabled:
            target.clear()
        return False
    def __hash__(self):
        return 0
enabled = False
target = {Bad() for _ in range(10)}
other = {Bad() for _ in range(10)}
enabled = True
target |= other
print(len(target))
