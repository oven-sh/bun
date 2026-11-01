# The layout of a compiled image, as the engine's headers have it: what `testaot list image-format` prints.
# $AOT_IMAGE_FORMAT names a file with that output. Without it, $TESTAOT (or `testaot` on the path) is asked.
import os, struct, subprocess

SIZE_OF_TABLE_ELEMENT = "the size of an element of ProgramTables::"


def facts_of_executable(data):
    """The facts that the run time in an executable states about itself (aot/image/AOTRuntimeDescription.h), or nothing."""
    at = data.find(b"BUNAOTRT")
    while at >= 0:
        size, count = struct.unpack_from("<II", data, at + 8)
        if at % 4 == 0 and size == 32 + 4 * count and 64 < count < 65536 and at + size <= len(data):
            return struct.unpack_from("<%dI" % count, data, at + 32)
        at = data.find(b"BUNAOTRT", at + 1)
    return ()


class ImageFormat:
    def __init__(self):
        path = os.environ.get("AOT_IMAGE_FORMAT")
        if path:
            text = open(path).read()
        else:
            command = [os.environ.get("TESTAOT", "testaot"), "list", "image-format"]
            text = subprocess.run(command, stdout=subprocess.PIPE, universal_newlines=True, check=True).stdout
        self.facts, self.sections, self.offsets = [], [], {}
        for line in text.splitlines():
            kind, _, rest = line.partition(" ")
            if kind == "fact":
                value, _, name = rest.partition(" ")
                self.facts.append((name, int(value)))
            elif kind == "section":
                self.sections.append(rest)
            elif kind == "offset":
                name, value = rest.split()
                self.offsets[name] = int(value)
        self.fact = dict(self.facts)
        # (name, size of an element), in the order of ProgramTables::ranges.
        self.tables = [(name[len(SIZE_OF_TABLE_ELEMENT):], size) for name, size in self.facts if name.startswith(SIZE_OF_TABLE_ELEMENT)]

    def differences_from(self, factsOfExecutable):
        """Why this list is not about the run time that states these facts about itself."""
        if len(factsOfExecutable) != len(self.facts):
            return ["the number of facts: %d there, %d in testaot" % (len(factsOfExecutable), len(self.facts))]
        return ["%s: %d there, %d in testaot" % (name, there, here) for (name, here), there in zip(self.facts, factsOfExecutable) if here != there]
