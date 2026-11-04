# What a built-in function has just returned is in use, though no frame refers to it yet. Finalizers come when they come, and that
# of a BytesIO with views looks for those that nothing refers to any more.
import io

big = bytes(1 << 17)
released = 0
for i in range(3000):
    view = io.BytesIO(big).getbuffer()
    try:
        len(view)
    except ValueError:
        released += 1
print(released)
