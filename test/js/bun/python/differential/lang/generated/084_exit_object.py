import sys
class O:
    def __str__(self): return "str of the object"
print("before")
sys.exit(O())
