print("before")
try:
    1 / 0
except ZeroDivisionError as e:
    raise RuntimeError("second, with é and 😀") from e
