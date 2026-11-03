import sys
print("before")
try:
    sys.exit(0)
finally:
    print("finally runs")
print("not reached")
