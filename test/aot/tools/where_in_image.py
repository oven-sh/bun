#!/usr/bin/env python3
# where_in_image.py <executable> [<hits.tsv>]
# For an executable built with `bun build --compile --aot`: says of each hit (a line "<id> <file offset, decimal or 0x..> <length in bytes>") WHERE IN THE COMPILED IMAGE it lies, WHAT KIND OF STRING holds it and WHICH TABLES NAME THAT STRING.
# Without a file of hits it only checks that it can read the image, and says how the bytes of the image's strings are shared out among the rows that name them.
# It only reads the two files. It prints ids, numbers, and names of sections, tables and kinds: NEVER A BYTE OF THE EXECUTABLE's TEXT.
#
# THE LISTS OF SECTIONS AND TABLES, THE SIZES OF RECORDS AND THE OFFSETS IN THE HEADER OF THE TABLES COME FROM THE ENGINE: `testaot list image-format` (image_format.py: $TESTAOT or $AOT_IMAGE_FORMAT).
#   Every run time describes itself in the executable (aot/image/AOTRuntimeDescription.h, AOTRuntimeFacts.def), and testaot prints the same facts with their names.
#   IT REFUSES AN EXECUTABLE WHOSE FACTS ARE NOT THOSE OF THAT testaot (exit status 2, no row): a label read through the wrong table is worse than none.
#   Then every table must lie inside its section and beside the others, and every number in a column that names a string or an identifier must be one.
#   A new table, a larger element and a member added at the end of a record need no change here. Whoever moves a member that is read here changes its reader: test/aot/where-names-lie-in-executables.test.ts holds the labels against a program whose names it knows.
#
# Columns: id . part (run time | image tables | image code, executed | image code, data behind it | behind the image) . section (for ProgramTables: + the table at or in front of the hit) . offset in the section .
#   fit: whole = the hit is exactly one string | part = it lies inside one string | spans = NO one string holds it: it runs over neighbours that lie end to end | none = no string record covers its start
#   strings = how many string records cover the hit (texts are shared: EVERY ONE of them must go before the bytes go) . length = characters of the shortest of them
#   kind: key = the string is the text of an identifier (a property key, a member's name, an export's name) . value = compiled code makes a string of it (a literal of the program) . both . shown = neither
#   width: 8 | 16 bits
#   named by = the rows that name any of the covering strings, joined by +:
#     of a string:      function-name . layout-name . environment-name . layout-set-name . type-site-text . module-path . module-directory . module-display-path . module-failure . export-statement . literal-union-member . bigint-digits . module-variable (a heap snapshot shows it)
#     of an identifier: layout-field:<record | instance | container (an enum, a namespace) | other>[:optional] . class-method . static-field . member-guard . export . indirect-export . synthetic-export . required-name .
#                       parsed-record-field (a parser or evaluated text may make the record: it finds the fields by their names) . added-name . removed-field . class-prototype-name . key-cell (compiled code holds the key) . environment-variable
#     none of these rows names it, only compiled code, its side tables or a record that is not walked here (data, requests, global bindings, runs of properties): code-value (a literal) . code-key .
#       code-reads-text (an operation or a regular expression reads the characters) . message-only (no header, no cell: it is only ever shown: the names in the language's messages: callees, variables before initialization ..)
import bisect, collections, hashlib, struct, sys
from image_format import ImageFormat

FORMAT = ImageFormat()
SECTIONS, FORM = FORMAT.sections, FORMAT.tables
IMAGE_FORMAT_VERSION = 2
# ImageHeader: the engine asserts that these two stay where they are.
OFFSET_OF_SECTIONS = 208
OFFSET_OF_CONSTANTS = 464
OFFSET_OF_RANGES = FORMAT.offsets["ProgramTables::ranges"]
LAYOUT, EXTENSION, CLASS, FIELD, METHOD, GUARD, AGGREGATES, ENVIRONMENT = (FORMAT.fact["sizeof(%s)" % name] for name in (
    "LayoutData", "ExtensionLayoutData", "ClassData", "FieldData", "MethodData", "MemberGuardData", "MemberGuardAggregates", "EnvironmentData"))
IS_16BIT, IS_ATOM, HAS_IDENTIFIER_NUMBER, HAS_NO_HEADER, HAS_TEXT, HAS_LISTED_HASH = 1 << 24, 1 << 25, 1 << 26, 1 << 27, 1 << 28, 1 << 29
NUMBER = (1 << 24) - 1


class Refusal(Exception):
    pass


def refuse(why):
    print("REFUSED: " + why)
    print("REFUSED: NOTHING IS SAID ABOUT THIS EXECUTABLE. Take the testaot of the build that the executable's Bun comes from.")
    sys.exit(2)


if len(sys.argv) < 2:
    sys.exit("where_in_image.py <executable> [<hits.tsv>]")
data = open(sys.argv[1], "rb").read()
hits = []
for line in open(sys.argv[2]) if len(sys.argv) > 2 else ():
    f = line.split()
    if len(f) >= 3 and not line.startswith("#"):
        hits.append((f[0], int(f[1], 0), int(f[2], 0)))


def every(needle, alignment):
    at = data.find(needle)
    while at >= 0:
        if at % alignment == 0:
            yield at
        at = data.find(needle, at + 1)


# What the run time says of itself.
def read_description():
    found = {}
    for at in every(b"BUNAOTRT", 4):
        size, numberOfFacts = struct.unpack_from("<II", data, at + 8)
        if size != 32 + 4 * numberOfFacts or not 64 < numberOfFacts < 65536 or at + size > len(data):
            continue
        found[data[at:at + size]] = at
    if not found:
        refuse("the executable holds no description of its run time (BUNAOTRT): it is no Bun that runs compiled images, or an older one")
    if len(found) > 1:
        refuse("the executable holds %d different descriptions of a run time" % len(found))
    record, at = next(iter(found.items()))
    architecture, operatingSystem, imageForm, checks, formatVersion = struct.unpack_from("<BBBBI", record, 24)
    return at, imageForm, formatVersion, struct.unpack_from("<%dI" % ((len(record) - 32) // 4), record, 32)


descriptionAt, imageForm, describedVersion, facts = read_description()
differences = []
if describedVersion != IMAGE_FORMAT_VERSION:
    differences.append("the format version of an image: %d there, %d here" % (describedVersion, IMAGE_FORMAT_VERSION))
differences += FORMAT.differences_from(facts)
if differences:
    refuse("the run time in this executable is not the one that testaot describes:\nREFUSED:   " + "\nREFUSED:   ".join(differences[:8]))
form = hashlib.sha256(",".join(str(n) for n in facts).encode()).hexdigest()[:16]

# Bun's own code holds the same eight bytes as an immediate.
def is_image(at):
    size, codeOffset = struct.unpack_from("<QQ", data, at + 32)
    return 0 < codeOffset < size and size % 16384 == 0 and codeOffset % 16384 == 0 and at + size <= len(data)


images = [at for at in every(b"BUNAOT01", 512) if at + 48 <= len(data) and is_image(at)]
print("# file %d B . images at %s . %d hits" % (len(data), [hex(i) for i in images], len(hits)))
print("# the run time describes itself at %#x: %d facts . the schema of the intermediate representation %08x%08x . images are %s . %d sections, %d tables (form %s)"
      % (descriptionAt, len(facts), facts[1], facts[0], "position-independent" if imageForm else "absolute", len(SECTIONS), len(FORM), form))
if not images:
    refuse("the executable holds no compiled image (BUNAOT01)")


def listed(words, n):
    if n >= len(words):
        return None, None
    if words[n] & 0xff:
        return words[n] >> 8, words[n] & 0xff
    if n + 2 < len(words):
        return words[n + 1], words[n + 2]
    return None, None


def covered(ranges):
    total, end = 0, 0
    for a, b in sorted(ranges):
        if b > end:
            total += b - max(a, end)
            end = b
    return total


class Image:
    def __init__(self, base):
        self.base = base
        self.size, self.codeOffset, self.codeSize, self.address, self.executableSize = struct.unpack_from("<QQQQQ", data, base + 32)
        self.version, = struct.unpack_from("<I", data, base + 72)
        if self.version != IMAGE_FORMAT_VERSION:
            raise Refusal("its format version is %d" % self.version)
        self.sections = {}
        for i, name in enumerate(SECTIONS):
            self.sections[name] = struct.unpack_from("<II", data, base + OFFSET_OF_SECTIONS + 8 * i)
        self.ordered = sorted((o, s, n) for n, (o, s) in self.sections.items())
        filled = [r for r in self.ordered if r[1]]
        if not all(o + s <= self.codeOffset <= self.size for o, s, _ in filled) or not all(a[0] + a[1] <= b[0] for a, b in zip(filled, filled[1:])) or base + self.size > len(data):
            raise Refusal("its sections do not lie one behind the other in front of its code")
        self.notes = []
        self.read_strings()
        self.read_tables()

    def words(self, name):
        o, s = self.sections[name]
        return struct.unpack_from("<%dI" % (s // 4), data, self.base + o)

    # The section StringHeaders has one of two forms: headers of 24 bytes that hold the address of the characters, or, in a position-independent image, records of 8 bytes: a range | an index into LongStrings, then hash and flags.
    def read_headers(self, listedWords):
        textOffset, textSize = self.sections["Text"]
        ho, hs = self.sections["StringHeaders"]
        ranges = []
        if imageForm:
            for i in range(hs // 8):
                r, flags = struct.unpack_from("<II", data, self.base + ho + 8 * i)
                if not flags:
                    ranges.append((None, None))
                    continue
                start, length = (r >> 8, r & 0xff) if r & 0xff else listed(listedWords, r >> 8)
                if not flags & HAS_TEXT or start is None or start + length * (2 if flags & IS_16BIT else 1) > textSize:
                    raise Refusal("StringHeaders: record %d names no range of Text" % i)
                ranges.append((start, length))
            return ranges
        # Where the characters lie is an address, or a distance that the loader or the run time turns into one: from the image, from Text or from the header itself.
        headers = [struct.unpack_from("<IIQII", data, self.base + ho + 24 * i) for i in range(hs // 24)]
        origins = {"the address of the image": lambda i: self.address + textOffset, "the image": lambda i: textOffset, "Text": lambda i: 0, "the header": lambda i: textOffset - ho - 24 * i}
        fitting = [name for name, origin in origins.items() if all(0 <= (h[2] - origin(i) & 0xffffffffffffffff) <= textSize - h[1] for i, h in enumerate(headers) if h[1])]
        if len(fitting) != 1:
            raise Refusal("StringHeaders: the characters of the %d headers lie in Text by %d of the %d ways to read them" % (len(headers), len(fitting), len(origins)))
        origin = origins[fitting[0]]
        return [(h[2] - origin(i) & 0xffffffffffffffff, h[1]) if h[1] else (None, None) for i, h in enumerate(headers)]

    def read_strings(self):
        textOffset, textSize = self.sections["Text"]
        strings, listedWords, identifiers, constants = self.words("Strings"), self.words("LongStrings"), self.words("Identifiers"), self.words("StringConstants")
        self.numberOfStrings, self.numberOfIdentifiers = len(strings), len(identifiers)
        headers = self.read_headers(listedWords)
        self.stringOfIdentifier = [(w & NUMBER) - 1 if w & NUMBER else None for w in identifiers]
        if any(s is not None and s >= len(strings) for s in self.stringOfIdentifier) or any(c >= len(strings) for c in constants):
            raise Refusal("Identifiers or StringConstants name a string that is not there")
        isKey = set(s for s in self.stringOfIdentifier if s is not None)
        isValue = set(constants)
        self.ranges = []  # (start in Text, end, string id, kind, width, length)
        self.withoutTable = {}
        self.withoutText = 0
        self.hasEmptyString = False
        for sid, w in enumerate(strings):
            if not w & HAS_TEXT:
                self.withoutText += 1
                continue
            wide = 2 if w & IS_16BIT else 1
            n = w & NUMBER
            start = length = None
            if w & HAS_NO_HEADER:
                start, length = listed(listedWords, n)
            elif n < len(headers):
                start, length = headers[n]
            if start is None and not w & HAS_NO_HEADER and n < len(headers) and not self.hasEmptyString:
                self.hasEmptyString = True
                continue
            if start is None or start < 0 or start + length * wide > textSize:
                raise Refusal("Strings: string %d has a text and no place in Text" % sid)
            kind = ("key" if sid in isKey or w & HAS_IDENTIFIER_NUMBER else "") + ("value" if sid in isValue or w & HAS_LISTED_HASH else "")
            kind = {"keyvalue": "both", "key": "key", "value": "value", "": "shown"}[kind]
            self.withoutTable[sid] = {"both": "code-key+code-value", "key": "code-key", "value": "code-value", "shown": "message-only" if w & HAS_NO_HEADER else "code-reads-text"}[kind]
            self.ranges.append((start, start + length * wide, sid, kind, 16 if wide == 2 else 8, length))
        self.ranges.sort()
        self.starts = [r[0] for r in self.ranges]
        self.longest = max((r[1] - r[0] for r in self.ranges), default=0)
        self.textCovered = covered((r[0], r[1]) for r in self.ranges)

    def read_tables(self):
        self.namedBy = collections.defaultdict(set)  # string id > names of rows
        po, ps = self.sections["ProgramTables"]
        start = self.base + po
        sizeOfHeader = OFFSET_OF_RANGES + 8 * len(FORM)
        if ps < sizeOfHeader or struct.unpack_from("<I", data, start)[0] != 0x44505943:
            raise Refusal("ProgramTables does not begin with its magic number")
        firstEnvironmentShape, = struct.unpack_from("<I", data, start + FORMAT.offsets["ProgramTables::firstEnvironmentShape"])
        self.tables, stride = {}, dict(FORM)
        for i, (name, _) in enumerate(FORM):
            self.tables[name] = struct.unpack_from("<II", data, start + OFFSET_OF_RANGES + 8 * i)
        # A table lies inside the section, behind the header. Two tables with the same bytes are written once; no two others share a byte.
        # The sets of shapes lie at the start of the constants of the code, where compiled code finds them by their distance.
        o, c = self.tables["shapeSetBits"]
        constantsOffset, constantsSize = struct.unpack_from("<II", data, self.base + OFFSET_OF_CONSTANTS)
        if c and (po + o != self.codeOffset + constantsOffset or c * stride["shapeSetBits"] > constantsSize):
            raise Refusal("ProgramTables: the table shapeSetBits does not lie at the start of the constants of the code")
        extents = sorted((o, o + c * stride[n], n) for n, (o, c) in self.tables.items() if c and n != "shapeSetBits")
        for o, end, n in extents:
            if o < sizeOfHeader or end > ps:
                raise Refusal("ProgramTables: the table %s (%d elements of %d B at +%d) does not lie inside the section" % (n, self.tables[n][1], stride[n], o))
        for a, b in zip(extents, extents[1:]):
            if a[1] > b[0] and a[:2] != b[:2]:
                raise Refusal("ProgramTables: the tables %s and %s share some of their bytes" % (a[2], b[2]))
        # What lies where in the section: (start, end, what).
        self.regions = [(0, sizeOfHeader, "header")] + extents

        def column(table, offset, width, row, ofIdentifier=False, skip=(), mask=None, only=None):
            o, count = self.tables[table]
            limit = self.numberOfIdentifiers if ofIdentifier else self.numberOfStrings
            numbers = []
            for i in range(count):
                p = start + o + i * stride[table] + offset
                n = int.from_bytes(data[p:p + width], "little")
                if only and not only(n):
                    continue
                if mask:
                    n &= mask
                if n in skip:
                    continue
                if n >= limit:
                    raise Refusal("ProgramTables: row %d of %s names %s %d of %d" % (i, table, "identifier" if ofIdentifier else "string", n, limit))
                numbers.append(n)
            self.name(numbers, row, ofIdentifier)
            self.notes.append("%s %d" % (row, len(numbers)))

        column("functionNames", 0, 3, "function-name")
        column("functionNameRuns", 4, 4, "function-name")
        column("layoutSets", 12, 4, "layout-set-name")
        column("typeSites", 13, 3, "type-site-text", skip=(NUMBER,))
        column("modules", 0, 4, "module-path")
        column("moduleDirectories", 3, 3, "module-directory")
        column("moduleDisplayPaths", 3, 3, "module-display-path")
        column("moduleFailures", 4, 4, "module-failure")
        # Where an export statement asks for what a module lacks, the first word holds what the statement is written from, under two marks.
        ofExportStatement = lambda word: word >> 30 == 3
        column("moduleFailures", 0, 4, "module-failure", only=ofExportStatement, mask=(1 << 30) - 1)
        column("exportStatements", 4, 4, "export-statement")
        column("exportStatements", 8, 4, "export-statement")
        o, count = self.tables["namedVariables"]
        cursor, numbers = start + o, []

        def varint():
            nonlocal cursor
            value, shift = 0, 0
            while True:
                byte = data[cursor]
                cursor += 1
                value |= (byte & 0x7f) << shift
                shift += 7
                if byte < 0x80:
                    return value
        while cursor < start + o + count:
            name = 0
            for _ in range(varint()):
                name += varint()
                varint()
                if name >= self.numberOfStrings:
                    raise Refusal("ProgramTables: namedVariables names string %d of %d" % (name, self.numberOfStrings))
                numbers.append(name)
        self.name(numbers, "module-variable", False)
        self.notes.append("module-variable %d" % len(numbers))
        o, count = self.tables["namedCaptures"]
        cursor, numbers, recent = start + o, [], []
        while cursor < start + o + count:
            varint()
            word = varint()
            if word & 1:
                if word >> 1 >= len(recent):
                    raise Refusal("ProgramTables: namedCaptures names list %d of the last %d" % (word >> 1, len(recent)))
                names = recent.pop(word >> 1)
            elif word:
                names = [varint() for _ in range(bin(word >> 1).count("1"))]
            else:
                names = [(varint(), varint())[1] for _ in range(varint())]
            recent.insert(0, names)
            del recent[64:]
            for name in names:
                if name >= self.numberOfStrings:
                    raise Refusal("ProgramTables: namedCaptures names string %d of %d" % (name, self.numberOfStrings))
                numbers.append(name)
        self.name(numbers, "captured-variable", False)
        self.notes.append("captured-variable %d" % len(numbers))
        column("literalStrings", 0, 4, "literal-union-member")
        column("bigIntConstants", 0, 4, "bigint-digits")
        column("moduleExports", 0, 3, "export", True)
        column("indirectExports", 4, 4, "indirect-export", True)
        column("syntheticExports", 0, 3, "synthetic-export", True)
        column("requiredNames", 4, 4, "required-name", True)
        column("parsedRecordFields", 0, 3, "parsed-record-field", True)
        column("addedNames", 4, 4, "added-name", True, skip=(0xffffffff, 0xfffffffe))
        column("removedFields", 4, 4, "removed-field", True, skip=(0xffffffff,))
        column("classPrototypeNames", 4, 4, "class-prototype-name", True, skip=(0xffffffff, 0xfffffffe))
        column("keyCellIdentifiers", 0, 4, "key-cell", True)

        # A layout: [ClassData] [ExtensionLayoutData] [the slot of the extra properties] LayoutData fields operands methods staticMethods staticFields memberGuards [aggregates]. An environment: EnvironmentData variables.
        o, count = self.tables["layouts"]
        counts = collections.Counter()
        strings, identifiers = [], []
        seen = set()
        for shape, at in enumerate(struct.unpack_from("<%dI" % count, data, start + o)):
            if not at or at in seen:
                continue
            seen.add(at)
            if at + LAYOUT > ps:
                raise Refusal("ProgramTables: the layout of shape %d lies outside the section" % shape)
            if shape >= firstEnvironmentShape:
                name, _, described = struct.unpack_from("<III", data, start + at + 12)
                end = at + ENVIRONMENT + 8 * described
                if end > ps:
                    raise Refusal("ProgramTables: the environment of shape %d runs out of the section" % shape)
                strings.append((name, "environment-name"))
                variables = (struct.unpack_from("<I", data, start + at + ENVIRONMENT + 8 * i)[0] for i in range(described))
                strings += [(variable, "environment-variable") for variable in variables if variable != 0xffffffff]
                self.regions.append((at, end, "the record of an environment"))
                continue
            word, _, _, name, _, numberOfFields, numberOfOperands = struct.unpack_from("<IIIIIHH", data, start + at)
            kind = {0: "record", 1: "instance", 2: "container"}.get(word & 15, "other")
            prefix = (4 if word >> 28 & 1 else 0) + (EXTENSION if word >> 29 & 1 else 0)
            methods = staticFields = guards = aggregates = 0
            if kind == "instance":
                prefix += CLASS
                if at < prefix:
                    raise Refusal("ProgramTables: the class of shape %d begins in front of the section" % shape)
                numberOfMethods, numberOfStaticMethods, staticFields, guardWord = struct.unpack_from("<IIII", data, start + at - prefix + 20)
                # ClassData: the count in 29 bits, then instancesCarryBrand, hasMemberGuardAggregates, guardsHoldWhileClear.
                methods, guards = numberOfMethods + numberOfStaticMethods, guardWord & (1 << 29) - 1
                aggregates = guards if guardWord >> 30 & 1 else 0
            p = at + LAYOUT
            end = p + FIELD * numberOfFields + 4 * numberOfOperands + METHOD * methods + FIELD * staticFields + GUARD * guards + AGGREGATES * aggregates
            if end > ps:
                raise Refusal("ProgramTables: the layout of shape %d runs out of the section" % shape)
            strings.append((name, "layout-name"))
            for i in range(numberOfFields):
                field, flags = struct.unpack_from("<IH", data, start + p + FIELD * i)
                identifiers.append((field & NUMBER, "layout-field:" + kind + (":optional" if flags & 1 else "")))
            p += FIELD * numberOfFields + 4 * numberOfOperands
            identifiers += [(struct.unpack_from("<I", data, start + p + METHOD * i)[0] & NUMBER, "class-method") for i in range(methods)]
            p += METHOD * methods
            identifiers += [(struct.unpack_from("<I", data, start + p + FIELD * i)[0] & NUMBER, "static-field") for i in range(staticFields)]
            p += FIELD * staticFields
            identifiers += [(struct.unpack_from("<I", data, start + p + GUARD * i)[0] & NUMBER, "member-guard") for i in range(guards)]
            self.regions.append((at - prefix, end, "the record of a layout"))
        for numbers, ofIdentifier, limit in ((strings, False, self.numberOfStrings), (identifiers, True, self.numberOfIdentifiers)):
            for n, row in numbers:
                if n >= limit:
                    raise Refusal("ProgramTables: a %s names %s %d of %d" % (row, "identifier" if ofIdentifier else "string", n, limit))
                self.name([n], row, ofIdentifier)
                counts[row.split(":")[0]] += 1
        self.notes += ["%s %d" % (row, n) for row, n in sorted(counts.items())]
        # The texts of the functions that show theirs: entries of 11 bytes (function in 3, start, end) and the characters. Then where the pieces of the text stood in their files:
        # 8 bytes (module, start) for each module that has some and 8 more that end the last, and the pieces.
        for i in range(self.tables["functionTexts"][1]):
            numberOfEntries, entriesOffset, textOffset, modulesWithPieces, modulesOffset, piecesOffset = struct.unpack_from("<IIIIII", data, start + self.tables["functionTexts"][0] + 24 * i)
            if modulesOffset + 8 * (modulesWithPieces + 1) > ps:
                raise Refusal("ProgramTables: the modules with pieces of the texts of functions run out of the section")
            sizeOfPieces = struct.unpack_from("<I", data, start + modulesOffset + 8 * modulesWithPieces + 4)[0]
            if piecesOffset + sizeOfPieces > ps:
                raise Refusal("ProgramTables: the pieces of the texts of functions run out of the section")
            self.regions += [(modulesOffset, modulesOffset + 8 * (modulesWithPieces + 1), "where the texts of functions stood"), (piecesOffset, piecesOffset + sizeOfPieces, "where the texts of functions stood")]
            if entriesOffset + 11 * numberOfEntries > ps:
                raise Refusal("ProgramTables: the entries of the texts of functions run out of the section")
            size = max((struct.unpack_from("<I", data, start + entriesOffset + 11 * e + 7)[0] for e in range(numberOfEntries)), default=0)
            if textOffset + size > ps:
                raise Refusal("ProgramTables: the texts of functions run out of the section")
            self.regions += [(entriesOffset, entriesOffset + 11 * numberOfEntries, "the entries of the texts of functions"), (textOffset, textOffset + size, "the texts of functions")]
            self.notes.append("functions that show their text %d" % numberOfEntries)
        self.regions.sort()
        self.regionStarts = [r[0] for r in self.regions]
        self.bytesBy = collections.Counter()
        end = 0
        for a, b, what in self.regions:
            if b > end:
                self.bytesBy[what if what[0] == "t" and " " in what or what == "header" else "tables"] += b - max(a, end)
                end = b
        self.bytesBy["other records"] = ps - sum(self.bytesBy.values())

    def name(self, numbers, row, ofIdentifier):
        for n in numbers:
            if ofIdentifier:
                n = self.stringOfIdentifier[n]
                if n is None:
                    continue
            self.namedBy[n].add(row)

    def covering(self, offset):
        i = bisect.bisect_right(self.starts, offset)
        found = []
        j = i - 1
        while j >= 0 and self.starts[j] >= offset - self.longest:
            if self.ranges[j][1] > offset:
                found.append(self.ranges[j])
            j -= 1
        return found

    def table_at(self, offset):
        i = bisect.bisect_right(self.regionStarts, offset)
        for a, b, what in reversed(self.regions[max(0, i - 4):i]):
            if a <= offset < b:
                return what
        return "a record that is not walked, behind " + self.regions[i - 1][2]


loaded = []
for base in images:
    try:
        loaded.append(Image(base))
    except (Refusal, struct.error) as why:
        refuse("the image at %#x: %s" % (base, why))
for im in loaded:
    inSections = sum(s for _, s, _ in im.ordered)
    print("# image at %#x: size %d . code at +%d, %d B, executed %d B . format version %d . strings %d: with a text %d, the empty one %d, without a text %d . identifiers %d" % (im.base, im.size, im.codeOffset, im.codeSize, im.executableSize, im.version, im.numberOfStrings, len(im.ranges), im.hasEmptyString, im.withoutText, im.numberOfIdentifiers))
    print("#   sections: " + " . ".join("%s +%d %d" % (n, o, s) for o, s, n in im.ordered if s))
    print("#   in front of the code %d B = the header and what fills up to a boundary %d + the sections %d . Text %d B: strings cover %d, no string %d" % (im.codeOffset, im.codeOffset - inSections, inSections, im.sections["Text"][1], im.textCovered, im.sections["Text"][1] - im.textCovered))
    print("#   ProgramTables %d B = " % im.sections["ProgramTables"][1] + " + ".join("%s %d" % (what, n) for what, n in im.bytesBy.items()) + " (other records: of types, orders of keys, data; and what fills up to a boundary) . %d tables, one of them, shapeSetBits, with the code" % len(FORM))
    print("#   tables, elements x size: " + " . ".join("%s %d x %d" % (n, im.tables[n][1], s) for n, s in FORM))
    print("#   rows read: " + " . ".join(im.notes))
    shares = collections.Counter()
    for r in im.ranges:
        shares[(r[3], "+".join(sorted(im.namedBy.get(r[2], ()))) or im.withoutTable[r[2]])] += r[1] - r[0]
    print("#   ALL the image's strings, bytes by kind | named by: " + " . ".join("%s | %s %d" % (k[0], k[1], n) for k, n in shares.most_common(24)))

tally = collections.Counter()
if hits:
    print("\t".join(["id", "part", "section", "offset in section", "fit", "strings", "length", "kind", "width", "named by"]))
for name, offset, length in hits:
    im = next((i for i in loaded if i.base <= offset < i.base + i.size), None)
    if not im:
        part = "run time" if offset < loaded[0].base else "behind the image"
        print("\t".join([name, part] + ["-"] * 8)); tally[(part, "-", "-", "-", "-")] += 1
        continue
    inside = offset - im.base
    part = "image tables" if inside < im.codeOffset else "image code, executed" if inside < im.codeOffset + im.executableSize else "image code, data behind it"
    section, at = next(((n, inside - o) for o, s, n in im.ordered if o <= inside < o + s), ("header" if inside < min(o for o, s, _ in im.ordered if s) else "between sections", inside))
    fit = strings = shortest = kind = width = named = "-"
    if section == "ProgramTables":
        section += ": " + im.table_at(at)
    if section == "Text":
        cover = im.covering(at)
        holding = [r for r in cover if r[1] >= at + length]
        strings = str(len(holding) or len(cover))
        if not cover:
            fit = "none"
        else:
            of = holding or cover
            kinds = set(r[3] for r in of)
            kind = "both" if "both" in kinds or {"key", "value"} <= kinds else "key" if "key" in kinds else "value" if "value" in kinds else "shown"
            rows = set()
            for r in of:
                rows |= im.namedBy.get(r[2]) or {im.withoutTable[r[2]]}
            named = "+".join(sorted(rows))
            if not holding:
                fit = "spans"
            else:
                best = min(holding, key=lambda r: r[1] - r[0])
                fit = "whole" if best[0] == at and best[1] == at + length else "part"
                shortest, width = str(best[5]), str(best[4])
    print("\t".join([name, part, section, str(at), fit, strings, shortest, kind, width, named]))
    tally[(part, section, fit, kind, named)] += 1
if hits:
    print("# IN ALL, hits by part | section | fit | kind | named by:")
for k, n in tally.most_common():
    print("# %5d  %s" % (n, " | ".join(k)))
