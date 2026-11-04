# A `return` that has got as far as a `finally` and is given up there, by a `break` or a `continue`: what the function returns in the end.
import warnings
warnings.simplefilter('ignore')
def f1():
    for i in (2,):
        try:
            try:
                return 1
            finally:
                break
        finally:
            pass
def f2():
    for i in (2,):
        try:
            return 1
        finally:
            break
def f3():
    for i in (1, 2):
        try:
            try:
                return i
            finally:
                continue
        finally:
            pass
    return 'end'
def f4():
    for i in (2,):
        with open(__file__):
            try:
                return 1
            finally:
                break
    return 'end'
def f5():
    for i in (2,):
        try:
            try:
                raise ValueError(1)
            finally:
                break
        finally:
            pass
    return 'end'
def f6():
    while True:
        try:
            try:
                return 1
            finally:
                break
        except ValueError:
            pass
    return 'end'
def f7():
    for i in (2,):
        try:
            try:
                try:
                    return 1
                finally:
                    break
            finally:
                pass
        finally:
            pass
    return 'end'
def f8():
    try:
        for i in (2,):
            try:
                return 1
            finally:
                break
    finally:
        pass
    return 'end'
for f in (f1, f2, f3, f4, f5, f6, f7, f8):
    print(f.__name__, f())


# The loop stands in a `finally` that another `return` is running: that one goes on.
def f9():
    try:
        return 'outer'
    finally:
        for i in (2,):
            try:
                return 'inner'
            finally:
                break


def f10():
    for j in (1,):
        try:
            return 'outer'
        finally:
            for i in (2,):
                try:
                    return 'inner'
                finally:
                    break


def f11():
    for j in (1,):
        try:
            return 'outer'
        finally:
            for i in (2,):
                try:
                    return 'inner'
                finally:
                    break
            break


def f12(n):
    while n:
        try:
            return n
        finally:
            n -= 1
            if n == 1:
                break
            continue


def f13():
    for i in (1, 2):
        with open(__file__):
            try:
                return i
            finally:
                if i == 2:
                    break
                continue


async def f14():
    for i in (2,):
        try:
            return 1
        finally:
            break


def f15():
    for i in (2,):
        try:
            return (yield 1)
        finally:
            break


for f in (f9, f10, f11, lambda: f12(3), f13):
    print(f())
try:
    f14().send(None)
except StopIteration as e:
    print(e.value)
g = f15()
print(next(g))
try:
    g.send(5)
except StopIteration as e:
    print(e.value)
