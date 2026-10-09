#!/usr/bin/env python3
"""Where the tags of JSDoc comments are, by the rules of TypeScript and by those of oxc_jsdoc: what `bun-lint jsdoc outline` says,
what two models in this file say, and how often the two sets of rules disagree on real code.

    outline.py [options] <files or directories..>

    --bin=<bun-lint>         compares `bun-lint jsdoc outline <paths>` with the models, row by row. Without it the comments are
                             found with a regular expression, and only the models are compared with each other.
    --oxlint=<oxlint>        asks oxlint where the tags are: every tag gets a name that `jsdoc/check-tag-names` reports.
    --typescript=<package>   asks `ts.parseIsolatedJSDocComment` of a TypeScript in JavaScript (up to 6.0), which has neither
                             fenced code blocks nor `CanFollowJSDocAt`: the model is run without them.
    --fuzz=<n>               n comments made of pieces that matter, beside those of the paths. TypeScript is not asked about them.
    --examples=<n>           how many examples are printed of each kind of difference. 8 by default.

`bun-lint jsdoc outline <files or directories..>` prints, with tabs between the columns and offsets in bytes:

    F  path
    C  start  end                                   a comment that starts with `/**`, is not `/**/`, and is closed
    T  at  name_end  type.start  type.end  name.start  name.end  default.start  default.end  text  end  depth     by TypeScript
    O  the same columns                                                                                          by oxc_jsdoc

The rows of a comment follow it, those of TypeScript first, each in the order of the text. `0 0` is a range that is not there.

The exit code is 1 if the binary, oxlint or TypeScript contradict a model.

The models: `typescript` is jsdoc.go of TypeScript 7 as far as it decides where tags, types, names and texts are. Types and default
values are passed over by their brackets, as the checker's reader does. `oxc` is the crate oxc_jsdoc of oxlint 1.87 and oxfmt 0.72.
"""

import collections
import json
import os
import random
import re
import subprocess
import sys
import tempfile

sys.setrecursionlimit(20000)

# ───────────────────────────── characters ─────────────────────────────


def char_and_size(text, at):
    if at >= len(text):
        return (-1, 0)
    first = text[at]
    if first < 0x80:
        return (first, 1)
    for size in (2, 3, 4):
        try:
            return (ord(text[at : at + size].decode("utf-8")), size)
        except (UnicodeDecodeError, TypeError):
            pass
    return (0xFFFD, 1)


def last_char(text, end):
    for size in (1, 2, 3, 4):
        if end - size < 0:
            break
        try:
            return ord(text[end - size : end].decode("utf-8"))
        except (UnicodeDecodeError, TypeError):
            pass
    return -1 if end == 0 else 0xFFFD


def is_identifier_start(c):
    if c < 0:
        return False
    if c < 0x80:
        return chr(c).isalpha() or c in (0x24, 0x5F)
    return chr(c).isidentifier()


def is_identifier_part(c):
    if c < 0:
        return False
    if c < 0x80:
        return chr(c).isalnum() or c in (0x24, 0x5F)
    return ("a" + chr(c)).isidentifier() or c in (0x200C, 0x200D)


TS_SPACES = {0x09, 0x0B, 0x0C, 0x20, 0xA0, 0x1680, 0x202F, 0x205F, 0x3000, 0xFEFF, 0x85, 0x200B} | set(range(0x2000, 0x200B))


def is_white_space_single_line(c):
    return c in TS_SPACES


def line_break_len(text, at):
    if at < len(text) and text[at] in (0x0A, 0x0D):
        return 1
    if text[at : at + 3] in (b"\xe2\x80\xa8", b"\xe2\x80\xa9"):
        return 3
    return 0


def end_of_run(text, at, pred):
    while True:
        c, size = char_and_size(text, at)
        if size == 0 or not pred(c):
            return at
        at += size


RUST_SPACES = {0x09, 0x0A, 0x0B, 0x0C, 0x0D, 0x20, 0x85, 0xA0, 0x1680, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000} | set(
    range(0x2000, 0x200B)
)


def rust_space_len(text, at):
    c, size = char_and_size(text, at)
    return size if c in RUST_SPACES else 0


# ───────────────────────────── `Scan`, as far as it is needed ─────────────────────────────


def line_end(text, at):
    while at < len(text) and line_break_len(text, at) == 0:
        at += 1
    return at


def skip_trivia(text, at):
    while at < len(text):
        c = text[at]
        if c in (0x0A, 0x0D, 0x20, 0x09, 0x0B, 0x0C):
            at += 1
        elif c == 0x2F and text[at + 1 : at + 2] == b"/":
            at = line_end(text, at + 2)
        elif c == 0x2F and text[at + 1 : at + 2] == b"*":
            found = text.find(b"*/", at + 2)
            at = len(text) if found < 0 else found + 2
        elif c >= 0x80:
            ch, size = char_and_size(text, at)
            if ch in (0x2028, 0x2029) or is_white_space_single_line(ch):
                at += size
            else:
                return at
        else:
            return at
    return min(at, len(text))


LONG_OPERATORS = [
    b"...", b"===", b"!==", b"**=", b"<<=", b"&&=", b"||=", b"??=", b"=>", b"==", b"!=", b"<=", b"++", b"--", b"+=", b"-=",
    b"*=", b"/=", b"%=", b"&=", b"|=", b"^=", b"&&", b"||", b"??", b"**", b"<<", b"?.",
]  # fmt: skip


def peek_unicode_escape(text, at):
    """The code point that the escape at `at`, a backslash, stands for, and its length."""
    found = re.compile(rb"\\u(?:\{([0-9A-Fa-f]+)\}|([0-9A-Fa-f]{4}))").match(text, at)
    if not found:
        return None
    value = int(found.group(1) or found.group(2), 16)
    return (value, found.end() - at) if value <= 0x10FFFF else None


def ident_end(text, at):
    """`scanIdentifierParts`"""
    while True:
        at = end_of_run(text, at, is_identifier_part)
        escape = peek_unicode_escape(text, at) if text[at : at + 1] == b"\\" else None
        if escape is None or not is_identifier_part(escape[0]):
            return at
        at += escape[1]


def string_end(text, at):
    quote = text[at]
    at += 1
    while at < len(text):
        c = text[at]
        if c == quote:
            return at + 1
        if c == 0x5C:
            at += 2
            continue
        if c in (0x0A, 0x0D):
            return at
        at += 1
    return len(text)


def token_end(text, at):
    if at >= len(text):
        return len(text)
    first = text[at]
    if first in (0x22, 0x27):
        return string_end(text, at)
    if first == 0x60:
        found = at + 1
        while found < len(text) and text[found] != 0x60:
            if text[found : found + 2] == b"${":
                return found + 2
            found += 2 if text[found] == 0x5C else 1
        return min(found + 1, len(text))
    if 0x30 <= first <= 0x39:
        return end_of_run(text, at, lambda c: is_identifier_part(c) or c == 0x2E)
    if first == 0x23:
        return ident_end(text, at + 1)
    for operator in LONG_OPERATORS:
        if text.startswith(operator, at):
            return at + len(operator)
    c, size = char_and_size(text, at)
    if is_identifier_start(c):
        return ident_end(text, at)
    return at + max(size, 1)


def end_of_brackets(text, open_at):
    """The position past the bracket that matches the one at `open_at`. None: it is never closed."""
    closers = {0x28: 0x29, 0x5B: 0x5D, 0x7B: 0x7D}
    stack = [closers[text[open_at]]]
    at = open_at + 1
    while True:
        at = skip_trivia(text, at)
        if at >= len(text):
            return None
        c = text[at]
        if c in closers:
            stack.append(closers[c])
            at += 1
        elif c in (0x29, 0x5D, 0x7D):
            if stack[-1] != c:
                return None
            stack.pop()
            at += 1
            if not stack:
                return at
        else:
            at = token_end(text, at)


def closing_bracket_after(text, start):
    depth = 0
    for i in range(start, len(text)):
        c = text[i]
        if c in b"([{":
            depth += 1
        elif c in b")]}":
            if depth == 0:
                return i
            depth -= 1
    return len(text)


# ───────────────────────────── TypeScript ─────────────────────────────

(EOF, SPACE, NEWLINE, TEXT, AT, STAR, LBRACE, RBRACE, LBRACKET, RBRACKET, EQUALS, DOT, BACKTICK, IDENT, PRIVATE, OTHER) = range(16)
BEGINNING, SAW_STAR, SAVING, SAVING_BACKTICKS = range(4)
PROPERTY, PARAMETER, CALLBACK_PARAMETER = 1, 2, 4
TAKES_BRACE = {
    b"implements", b"augments", b"extends", b"this", b"return", b"returns", b"template", b"type", b"satisfies", b"exception",
    b"throws", b"import",
}  # fmt: skip
RESERVED = set(
    b"break case catch class const continue debugger default delete do else enum export extends false finally for function if import in instanceof new null return super switch this throw true try typeof var void while with".split()
)


def saving(fenced):
    return SAVING_BACKTICKS if fenced else SAVING


class TypeScript:
    def __init__(self, source, start, end, has_fences=True):
        self.text = source[: end - 2]
        self.token, self.full_start, self.start, self.pos, self.line_break_before = OTHER, start + 3, start + 3, start + 3, False
        self.rows = []
        self.depth = 0
        # TypeScript 6 has neither fenced code blocks nor `CanFollowJSDocAt`.
        self.has_fences = has_fences
        self.steps = 0
        self.comment(start)

    # scanner
    def state(self):
        return (self.token, self.full_start, self.start, self.pos, self.line_break_before)

    def restore(self, state):
        (self.token, self.full_start, self.start, self.pos, self.line_break_before) = state

    def mark(self):
        return (self.state(), len(self.rows))

    def rewind(self, mark):
        self.restore(mark[0])
        del self.rows[mark[1] :]

    def next_jsdoc(self):
        self.steps += 1
        text, start = self.text, self.pos
        pos = start + 1
        if start >= len(text):
            pos, token = start, EOF
        else:
            c = text[start]
            if c in (0x09, 0x0B, 0x0C, 0x20):
                pos, token = end_of_run(text, pos, is_white_space_single_line), SPACE
            elif c == 0x40:
                token = AT
            elif c == 0x0D and text[pos : pos + 1] == b"\n":
                pos, token = pos + 1, NEWLINE
            elif c in (0x0A, 0x0D):
                token = NEWLINE
            elif c in SINGLE:
                token = SINGLE[c]
            elif c == 0x5C:
                escape = peek_unicode_escape(text, start)
                if escape is not None and is_identifier_start(escape[0]):
                    pos, token = ident_end(text, start + escape[1]), IDENT
                else:
                    token = OTHER
            else:
                ch, size = char_and_size(text, start)
                pos = start + size
                if is_identifier_start(ch):
                    pos, token = end_of_run(text, pos, lambda c: is_identifier_part(c) or c == 0x2D), IDENT
                    if text[pos : pos + 1] == b"\\":
                        pos = ident_end(text, pos)
                else:
                    token = OTHER
        self.token, self.full_start, self.start, self.pos, self.line_break_before = token, start, start, pos, token == NEWLINE
        return token

    def next_text(self, in_backticks):
        self.steps += 1
        text, start = self.text, self.pos
        pos = start
        while pos < len(text):
            c = text[pos]
            if c == 0x60 or line_break_len(text, pos):
                break
            if not in_backticks:
                if c == 0x7B:
                    break
                if c == 0x40 and is_white_space_single_line(last_char(text, pos)):
                    after = char_and_size(text, pos + 1)[0]
                    # TypeScript 6: "not followed by white space"
                    if is_identifier_start(after) if self.has_fences else not (
                        pos + 1 < len(text) and (is_white_space_single_line(after) or line_break_len(text, pos + 1))
                    ):
                        break
            pos += 1
        if pos == start:
            return self.next_jsdoc()
        self.token, self.full_start, self.start, self.pos, self.line_break_before = TEXT, start, start, pos, False
        return TEXT

    def can_follow_at(self):
        if not self.has_fences:
            return True
        c, size = char_and_size(self.text, self.pos)
        return size == 0 or is_identifier_start(c) or is_white_space_single_line(c) or line_break_len(self.text, self.pos) != 0

    def next_token(self):
        self.steps += 1
        text, full_start = self.text, self.pos
        start = skip_trivia(text, full_start)
        pos = token_end(text, start)
        if start >= len(text):
            token = EOF
        else:
            c = text[start]
            one = pos == start + 1
            if c == 0x40:
                token = AT
            elif c in (0x7B, 0x7D, 0x5B, 0x5D):
                token = SINGLE[c]
            elif c == 0x2A and one:
                token = STAR
            elif c == 0x3D and one:
                token = EQUALS
            elif c == 0x2E and one:
                token = DOT
            elif c == 0x23 and text[start + 1 : start + 2] != b"!":
                token = PRIVATE
            elif 0x30 <= c <= 0x39:
                token = OTHER
            elif is_identifier_start(char_and_size(text, start)[0]):
                token = IDENT
            else:
                token = OTHER
        self.line_break_before = any(line_break_len(text, at) for at in range(full_start, start))
        self.token, self.full_start, self.start, self.pos = token, full_start, start, pos
        return token

    def reset_pos(self, pos):
        self.full_start = self.start = self.pos = pos

    def value(self):
        """`TokenValue`: the escapes are decoded."""
        decode = lambda found: chr(peek_unicode_escape(found.group(), 0)[0]).encode("utf-8", "replace")
        return re.sub(rb"\\u(?:\{[0-9A-Fa-f]+\}|[0-9A-Fa-f]{4})", decode, self.text[self.start : self.pos])

    def optional(self, token):
        if self.token == token:
            self.next_token()
            return True
        return False

    def optional_jsdoc(self, token):
        if self.token == token:
            self.next_jsdoc()
            return True
        return False

    # comments
    def comment(self, start):
        line_start = self.text.rfind(b"\n", 0, start) + 1
        indent = start + 4 - line_start
        state, backticks, fenced = SAW_STAR, 0, False
        self.next_jsdoc()
        while self.optional_jsdoc(SPACE):
            pass
        if self.optional_jsdoc(NEWLINE):
            state, indent = BEGINNING, 0
        while True:
            if self.token != BACKTICK and backticks > 0:
                if self.has_fences:
                    fenced ^= backticks >= 3
                backticks = 0
            length, token = self.pos - self.start, self.token
            if token == AT and not fenced and self.can_follow_at():
                self.tag(indent)
                state = BEGINNING
            elif token == NEWLINE:
                state, indent = BEGINNING, 0
            elif token == STAR and state != SAW_STAR:
                state = SAW_STAR
                indent += length
            elif token == SPACE:
                indent += length
            elif token == EOF:
                break
            elif token == BACKTICK:
                backticks += 1
                state = saving(state != SAVING_BACKTICKS)
                indent += length
            elif token == LBRACE and not fenced:
                state = SAVING
                if not self.link():
                    indent += length
            elif token == STAR:
                state = SAVING
                indent += length
            elif token in (AT, LBRACE):
                state = saving(fenced)
                indent += length
            else:
                if state != SAVING_BACKTICKS:
                    state = saving(fenced)
                indent += length
            if state in (SAVING, SAVING_BACKTICKS):
                self.next_text(state == SAVING_BACKTICKS)
            else:
                self.next_jsdoc()

    def is_at_trailing_whitespace(self):
        state = self.state()
        token = self.token
        while token in (SPACE, NEWLINE):
            token = self.next_jsdoc()
        self.restore(state)
        return token == EOF

    def skip_whitespace(self):
        if self.is_at_trailing_whitespace():
            return
        while self.token in (SPACE, NEWLINE):
            self.next_jsdoc()

    def skip_whitespace_or_asterisk(self):
        if self.is_at_trailing_whitespace():
            return 0
        preceding, seen, indent = self.line_break_before, False, 0
        while True:
            if self.token == STAR and preceding:
                preceding = False
                indent += 1
            elif self.token == SPACE:
                indent += self.pos - self.start
            elif self.token == NEWLINE:
                preceding, seen, indent = True, True, 0
            else:
                break
            self.next_jsdoc()
        return indent if seen else 0

    # tags
    def open_row(self, at):
        self.rows.append([at, at + 1, 0, 0, 0, 0, 0, 0, 0, 0, self.depth])
        return len(self.rows) - 1

    def close_row(self, row):
        self.rows[row][9] = self.full_start

    def tag(self, margin):
        start = self.start
        row = self.open_row(start)
        self.next_jsdoc()
        name = self.identifier_name(row)
        indent_text = self.skip_whitespace_or_asterisk()
        if name in (b"arg", b"argument", b"param"):
            self.parameter_or_property(row, start, PARAMETER, margin)
        elif name == b"typedef":
            self.typedef(row, start, margin, indent_text)
        elif name == b"callback":
            self.declared_name(row)
            self.overload(row, start, margin, indent_text)
        elif name == b"overload":
            self.overload(row, start, margin, indent_text)
        else:
            self.without_children(row, start, name, margin, indent_text)
        self.close_row(row)
        return name in (b"return", b"returns")

    def without_children(self, row, start, name, margin, indent_text):
        if self.token == LBRACE and name in TAKES_BRACE:
            self.type_expression(row)
        self.trailing(row, start, self.full_start, margin, indent_text)

    def identifier_name(self, row=None):
        if self.token != IDENT:
            return b""
        text = self.value()
        if row is not None:
            self.rows[row][1] = self.pos
        self.next_jsdoc()
        return text

    def entity_name(self):
        entity = []
        while True:
            entity.append(self.identifier_name())
            if self.optional(LBRACKET):
                self.optional(RBRACKET)
            if not self.optional(DOT):
                return entity

    def type_expression(self, row):
        open_at, inside = self.start, self.pos
        if self.text[inside : inside + 1] == b"@":
            end = inside
        else:
            end = min(closing_bracket_after(self.text, inside) + 1, len(self.text))
        self.reset_pos(end)
        self.next_jsdoc()
        if row is not None and self.rows[row][3] == 0 and end > inside:
            self.rows[row][2], self.rows[row][3] = open_at, end
        # Not what follows the type expression: a `//`, a `/*` or a quote in it would be read to the end of the line or of the comment, for each tag.
        return (is_object_or_object_array(self.text[inside:end]), end)

    def try_type_expression(self, row):
        self.skip_whitespace_or_asterisk()
        return self.type_expression(row) if self.token == LBRACE else None

    def bracket_name(self, row):
        open_at = self.start
        bracketed = self.optional_jsdoc(LBRACKET)
        if bracketed:
            self.skip_whitespace()
        backquoted = self.optional_jsdoc(BACKTICK)
        name = self.entity_name()
        if backquoted:
            self.optional(BACKTICK)
        if bracketed:
            self.skip_whitespace()
            if self.token == EQUALS:
                after = end_of_brackets(self.text, open_at)
                close = len(self.text) if after is None else after - 1
                self.rows[row][6], self.rows[row][7] = self.pos, close
                self.reset_pos(close)
                self.next_token()
            self.optional(RBRACKET)
        if self.full_start > open_at:
            self.rows[row][4], self.rows[row][5] = open_at, self.full_start
        return name

    def parameter_or_property(self, row, start, target, indent, parent=None):
        ty = self.try_type_expression(row)
        self.skip_whitespace_or_asterisk()
        name = self.bracket_name(row)
        # It is rewound: there is no need to read on, and to try the next tag as a child of this one.
        if parent is not None and name[:-1] != parent:
            return name
        indent_text = self.skip_whitespace_or_asterisk()
        if ty is None:
            state = self.state()
            is_at_link = self.link_prefix()
            self.restore(state)
            if not is_at_link:
                ty = self.try_type_expression(row)
        self.trailing(row, start, self.full_start, indent, indent_text)
        if ty is not None and ty[0]:
            while self.child(target, indent, name) is not None:
                pass
        return name

    def declared_name(self, row):
        first = self.start
        while self.token == IDENT:
            self.next_jsdoc()
            if not self.optional_jsdoc(DOT):
                break
        if self.full_start > first:
            self.rows[row][4], self.rows[row][5] = first, self.full_start

    def typedef(self, row, start, indent, indent_text):
        ty = self.try_type_expression(row)
        self.skip_whitespace_or_asterisk()
        self.declared_name(row)
        end = self.full_start
        self.skip_whitespace()
        self.rows[row][8] = self.full_start
        has_comment = self.tag_comments(indent, None)
        if ty is None or ty[0]:
            has_children, child_type = False, None
            while True:
                child = self.child(PROPERTY, indent, None)
                if child is None:
                    break
                has_children = True
                if child[0] == "type" and child[1] is not None and child_type is None:
                    child_type = child[1]
            if has_children:
                end = child_type[1] if child_type is not None and not child_type[0] else self.full_start
        if not has_comment:
            self.trailing(row, start, end, indent, indent_text)

    def signature(self, indent):
        while self.child(CALLBACK_PARAMETER, indent, None) is not None:
            pass
        mark = self.mark()
        self.depth += 1
        if not (self.optional_jsdoc(AT) and self.token == AT and self.is_at_return_tag() and self.tag(indent)):
            self.rewind(mark)
        self.depth -= 1

    def is_at_return_tag(self):
        """Any other tag is read and rewound by jsdoc.go, which takes time in proportion to the square of the number of tags."""
        state = self.state()
        self.next_jsdoc()
        is_return = self.token == IDENT and self.value() in (b"return", b"returns")
        self.restore(state)
        return is_return

    def overload(self, row, start, indent, indent_text):
        self.skip_whitespace()
        self.rows[row][8] = self.full_start
        has_comment = self.tag_comments(indent, None)
        self.signature(indent)
        if not has_comment:
            self.trailing(row, start, self.full_start, indent, indent_text)

    def child(self, target, indent, name):
        mark = self.mark()
        can_parse, seen_star = True, False
        while True:
            token = self.next_jsdoc()
            if token == AT and can_parse and self.can_follow_at():
                child = self.try_child(target, indent, name)
                break
            if token == AT:
                seen_star = False
            elif token == NEWLINE:
                can_parse, seen_star = True, False
            elif token == STAR:
                can_parse = can_parse and not seen_star
                seen_star = True
            elif token == IDENT:
                can_parse = False
            elif token == EOF:
                child = None
                break
        if child is not None and child[0] == "name" and name is not None and child[1][:-1] != name:
            child = None
        if child is None:
            self.rewind(mark)
        return child

    def try_child(self, target, indent, parent):
        start = self.full_start
        self.depth += 1
        row = self.open_row(start)
        self.next_jsdoc()
        name = self.identifier_name(row)
        indent_text = self.skip_whitespace_or_asterisk()
        fits = PROPERTY if name in (b"prop", b"property") else (PARAMETER | CALLBACK_PARAMETER if name in (b"arg", b"argument", b"param") else 0)
        if name == b"type" and target == PROPERTY:
            child = ("type", self.try_type_expression(row))
        elif name in (b"template", b"this"):
            self.without_children(row, start, name, indent, indent_text)
            child = ("other",)
        elif target & fits:
            child = ("name", self.parameter_or_property(row, start, target, indent, parent))
        else:
            child = None
        if child is not None:
            self.close_row(row)
        self.depth -= 1
        return child

    def trailing(self, row, start, end, margin, indent_text):
        if indent_text == 0:
            margin += max(end - start, 0)
        self.rows[row][8] = self.full_start
        self.tag_comments(margin, max(indent_text - margin, 0))

    def tag_comments(self, indent, initial_margin):
        state = BEGINNING if initial_margin is None else SAW_STAR
        backticks, fenced, margin, has_comment = 0, False, None, False
        if initial_margin:
            margin = indent
            indent += initial_margin
        while True:
            if self.token != BACKTICK and backticks > 0:
                if self.has_fences:
                    fenced ^= backticks >= 3
                backticks = 0
            length, token, pushed = self.pos - self.start, self.token, True
            if token == NEWLINE:
                state, indent, pushed = BEGINNING, 0, False
            elif token == AT and not fenced and self.can_follow_at():
                self.reset_pos(self.pos - 1)
                break
            elif token == EOF:
                break
            elif token == SPACE:
                if margin is not None and indent + length > margin:
                    state = saving(fenced)
                indent += length
                pushed = False
            elif token == LBRACE and not fenced:
                state = SAVING
                pushed = not self.link()
                has_comment = has_comment or not pushed
            elif token in (AT, LBRACE):
                state = saving(fenced)
            elif token == BACKTICK:
                backticks += 1
                state = saving(state != SAVING_BACKTICKS)
            elif token == STAR and state == BEGINNING:
                state, pushed = SAW_STAR, False
                indent += 1
            elif state != SAVING_BACKTICKS:
                state = saving(fenced)
            if pushed:
                if margin is None:
                    margin = indent
                indent += length
                has_comment = has_comment or end_of_run(self.text, self.start, is_white_space_single_line) < self.pos
            if state in (SAVING, SAVING_BACKTICKS):
                self.next_text(state == SAVING_BACKTICKS)
            else:
                self.next_jsdoc()
        return has_comment

    def link(self):
        state = self.state()
        if not self.link_prefix():
            self.restore(state)
            return False
        self.next_jsdoc()
        self.skip_whitespace()
        self.link_name()
        while self.token not in (RBRACE, NEWLINE, EOF):
            self.next_jsdoc()
        return True

    def link_name(self):
        if self.token != IDENT:
            return
        self.next_token()
        while self.token == DOT:
            if self.next_token() == IDENT:
                self.next_token()
        while self.token == PRIVATE:
            self.pos = self.start + 1
            self.next_jsdoc()
            if self.token == IDENT and self.value() not in RESERVED:
                self.next_token()

    def link_prefix(self):
        self.skip_whitespace_or_asterisk()
        return (
            self.token == LBRACE
            and self.next_jsdoc() == AT
            and self.next_jsdoc() == IDENT
            and self.value() in (b"link", b"linkcode", b"linkplain")
        )


SINGLE = {0x2A: STAR, 0x7B: LBRACE, 0x7D: RBRACE, 0x5B: LBRACKET, 0x5D: RBRACKET, 0x3D: EQUALS, 0x2E: DOT, 0x60: BACKTICK}


def is_object_or_object_array(text):
    def token_after(at):
        start = skip_trivia(text, at)
        if text[start : start + 1] == b"*" and any(line_break_len(text, i) for i in range(at, start)):
            start = skip_trivia(text, start + 1)
        return (start, token_end(text, start))

    start, end = token_after(0)
    if text[start:end] not in (b"Object", b"object"):
        return False
    while True:
        open_at, after_open = token_after(end)
        close, after_close = token_after(after_open)
        if open_at >= len(text) or text[open_at] == 0x7D:
            return True
        if text[open_at] == 0x5B and text[close : close + 1] == b"]":
            end = after_close
        else:
            return False


def typescript(text, start, end, has_fences=True):
    # Nothing before the line of the comment matters, and a copy of it for each comment would.
    base = text.rfind(b"\n", 0, start) + 1
    rows = TypeScript(text[base:end], start - base, end - base, has_fences).rows
    return [tuple(it + base if it and column < 10 else it for column, it in enumerate(row)) for row in rows]


# ───────────────────────────── oxc_jsdoc ─────────────────────────────


def find_token_range(s):
    start, at = None, 0
    while at < len(s):
        space = rust_space_len(s, at)
        if space or s[at] == 0x7B:
            if start is not None:
                return (start, at)
        elif start is None:
            start = at
        at += space or char_and_size(s, at)[1]
    return None if start is None else (start, len(s))


def trim_start_len(s):
    at = 0
    while at < len(s) and rust_space_len(s, at):
        at += rust_space_len(s, at)
    return at


def find_type_range(s):
    offset = trim_start_len(s)
    if s[offset : offset + 1] != b"{":
        return None
    depth = 0
    for at in range(offset, len(s)):
        if s[at] == 0x7B:
            depth += 1
        elif s[at] == 0x7D:
            depth -= 1
            if depth == 0:
                return (offset, at + 1)
    return None


def find_type_name_range(s):
    if s[trim_start_len(s) : trim_start_len(s) + 1] != b"[":
        return find_token_range(s)
    bracket, start, at = 0, None, 0
    while at < len(s):
        space = rust_space_len(s, at)
        if space:
            if bracket == 0 and start is not None:
                return (start, at)
        else:
            bracket += (s[at] == 0x5B) - (s[at] == 0x5D)
            if start is None:
                start = at
        at += space or char_and_size(s, at)[1]
    return (start, len(s)) if start is not None and bracket == 0 else None


def oxc_starts(s):
    """Where the tags of `s`, which is between `/**` and `*/`, start."""
    starts = []
    curly = paren = square = backticks = 0
    double = single = False
    at_line_start, seen_star, spaces = True, False, 0
    at = 0
    while at < len(s):
        c = s[at]
        plain = backticks == 0 and not double and not single
        can_parse = plain and curly == 0 and square == 0 and paren == 0
        length = 1
        if c == 0x60 and not single and not double:
            while s[at + length : at + length + 1] == b"`":
                length += 1
            if backticks == 0:
                backticks = length
            elif backticks == length:
                backticks = 0
        elif c == 0x22 and backticks == 0 and not single:
            double = not double
        elif c == 0x27 and backticks == 0 and not double:
            single = not single
        elif c == 0x0A:
            double = single = False
            paren = square = 0
        elif c == 0x7B and plain:
            curly += 1
        elif c == 0x7D and plain:
            curly = max(curly - 1, 0)
        elif c == 0x28 and plain:
            paren += 1
        elif c == 0x29 and plain:
            paren = max(paren - 1, 0)
        elif c == 0x5B and plain:
            square += 1
        elif c == 0x5D and plain:
            square = max(square - 1, 0)
        elif c == 0x40 and can_parse and at_line_start and not (seen_star and spaces >= 5):
            starts.append(at)
        if c == 0x0A:
            at_line_start, seen_star, spaces = True, False, 0
        elif at_line_start:
            if c == 0x2A:
                seen_star, spaces = True, 0
            elif c in (0x20, 0x09, 0x0D):
                spaces += seen_star
            else:
                at_line_start = False
        at += length
    return starts


def oxc(text, start, end):
    base = start + 3
    s = text[base : end - 2]
    starts = oxc_starts(s)
    rows = []
    for index, at in enumerate(starts):
        tag_end = starts[index + 1] if index + 1 < len(starts) else len(s)
        content = s[at:tag_end]
        kind_end = find_token_range(content)[1]
        body = content[kind_end:]
        row = [base + at, base + at + kind_end, 0, 0, 0, 0, 0, 0, 0, base + tag_end, 0]
        rest_at = kind_end
        ty = find_type_range(body)
        if ty:
            row[2], row[3] = base + at + kind_end + ty[0], base + at + kind_end + ty[1]
            rest_at = kind_end + ty[1]
        name = find_type_name_range(content[rest_at:])
        if name:
            row[4], row[5] = base + at + rest_at + name[0], base + at + rest_at + name[1]
            raw = content[rest_at + name[0] : rest_at + name[1]]
            if raw.startswith(b"[") and raw.endswith(b"]") and b"=" in raw:
                row[6], row[7] = row[4] + raw.index(b"=") + 1, row[5] - 1
            rest_at += name[1]
        row[8] = base + at + rest_at
        rows.append(tuple(row))
    return rows


class LineStartRule:
    """What oxc_jsdoc knows at a position, without what cannot matter: parentheses and square brackets are forgotten at the end of
    a line, and a tag starts a line."""

    def __init__(self):
        self.curly = self.backticks = self.quote = 0
        self.first_on_line, self.seen_star, self.spaces = True, False, 0

    def advance(self, s, upto):
        at = 0
        while at < upto:
            c = s[at]
            length = 1
            if c == 0x60:
                if not self.quote:
                    while s[at + length : at + length + 1] == b"`":
                        length += 1
                    if self.backticks == 0:
                        self.backticks = length
                    elif self.backticks == length:
                        self.backticks = 0
            elif c in (0x22, 0x27):
                if self.backticks == 0:
                    self.quote = c if self.quote == 0 else 0 if self.quote == c else self.quote
            elif c == 0x0A:
                self.quote = 0
            elif c == 0x7B and self.backticks == 0 and not self.quote:
                self.curly += 1
            elif c == 0x7D and self.backticks == 0 and not self.quote:
                self.curly = max(self.curly - 1, 0)
            if c == 0x0A:
                self.first_on_line, self.seen_star, self.spaces = True, False, 0
            elif self.first_on_line:
                if c == 0x2A:
                    self.seen_star, self.spaces = True, 0
                elif c in (0x20, 0x09, 0x0D):
                    self.spaces += self.seen_star
                else:
                    self.first_on_line = False
            at += length

    def why_not(self):
        if not self.first_on_line:
            return "it is not the first on its line"
        if self.curly:
            return "a { is open"
        if self.backticks:
            return "backticks are open"
        if self.seen_star and self.spaces >= 5:
            return "five blanks or more are behind the *"
        return "?"


# ───────────────────────────── the comparison ─────────────────────────────

EXTENSIONS = (".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".mts", ".cts")
COMMENT = re.compile(rb"/\*\*(?!/).*?\*/", re.S)
COLUMNS = ("at", "name_end", "type.start", "type.end", "name.start", "name.end", "default.start", "default.end", "text", "end", "depth")


def files_in(root):
    if os.path.isfile(root):
        yield root
        return
    for directory, directories, names in os.walk(root):
        directories[:] = sorted(it for it in directories if it not in ("node_modules", ".git"))
        for name in sorted(names):
            if name.endswith(EXTENSIONS):
                yield os.path.join(directory, name)


def fuzzed(count, seed=1):
    pieces = [
        "@a", "@b-c", "@d.e", "@param", "@typedef", "@type", "@property", "@callback", "@overload", "@returns", "{Object}", "{string}", " ", " ", "\n * ",
        "\n * ", "\n", "*", "`", "``", "```", "````", "{", "}", "'", '"', "(", ")", "[", "]", "     ", "\t", "\r\n * ", "\r", "x", "a.b",
        "word", "@", "{@link a}", "\n *      ", "\n *     ", "é", " ", "\x0b", "\x0c", " ", "=", "\\", "@1", "@{", "\n\t",
    ]  # fmt: skip
    pieces = [it.encode() for it in pieces]
    choose = random.Random(seed)
    for _ in range(count):
        body = b"".join(choose.choice(pieces) for _ in range(choose.randint(1, 24)))
        yield b"/**" + body.replace(b"*/", b"* /") + b" */"


class Report:
    def __init__(self, examples):
        self.counts, self.examples, self.limit, self.failed = collections.Counter(), collections.defaultdict(list), examples, False

    def count(self, what, example=None, by=1):
        self.counts[what] += by
        if example is not None and len(self.examples[what]) < self.limit:
            self.examples[what].append(example)

    def fail(self, what, example):
        self.failed = True
        self.count("CONTRADICTION: " + what, example)

    def print(self):
        for what, count in self.counts.items():
            print(f"{count:>10}  {what}")
        for what, examples in self.examples.items():
            print("──", what)
            for example in examples:
                print("    ", example)


def line_of(text, at):
    start = text.rfind(b"\n", 0, at) + 1
    end = text.find(b"\n", at)
    return text[start : len(text) if end < 0 else end][:140]


def compare_flavors(report, path, text, start, end, by_typescript, by_oxc):
    report.count("tags by TypeScript", by=len(by_typescript))
    report.count("tags by oxc_jsdoc", by=len(by_oxc))
    report.count("tags by TypeScript that are in another tag", by=sum(1 for row in by_typescript if row[10]))
    ours, theirs = {row[0]: row for row in by_typescript}, {row[0]: row for row in by_oxc}
    if ours.keys() != theirs.keys():
        report.count("comments in which tags start elsewhere")
    for at in sorted(ours.keys() - theirs.keys()):
        rule = LineStartRule()
        rule.advance(text[start + 3 : end - 2], at - start - 3)
        report.count("a tag for TypeScript only: " + rule.why_not(), (path, at, line_of(text, at)))
    for at in sorted(theirs.keys() - ours.keys()):
        after = char_and_size(text[: end - 2], at + 1)
        can_follow = after[1] == 0 or is_identifier_start(after[0]) or is_white_space_single_line(after[0]) or line_break_len(text, at + 1)
        why = "something else (a fence, a second *, a type or a default that is passed over)" if can_follow else "what follows the @"
        report.count("a tag for oxc_jsdoc only: because of " + why, (path, at, line_of(text, at)))
    for at in sorted(ours.keys() & theirs.keys()):
        a, b = ours[at], theirs[at]
        if a[1] != b[1]:
            report.count("the same tag: another name", (path, at, text[at : max(a[1], b[1]) + 2]))
        if a[2:4] != b[2:4]:
            which = "only oxc_jsdoc has one" if a[3] == 0 else "only TypeScript has one" if b[3] == 0 else "it ends elsewhere"
            report.count("the same tag: the type: " + which, (path, at, text[at : at + 80]))
        if ours.keys() == theirs.keys() and a[9] != b[9] and not any(row[10] for row in by_typescript):
            report.count("the same tags: another end", (path, at, a[9], b[9]))


def rows_of_binary(binary, paths):
    """(path, [(start, end, rows by TypeScript, rows by oxc)]) for each file."""
    process = subprocess.Popen([binary, "jsdoc", "outline", *paths], stdout=subprocess.PIPE)
    path, comments = None, []
    for line in process.stdout:
        columns = line.rstrip(b"\n").split(b"\t")
        if columns[0] == b"F":
            if path is not None:
                yield (path, comments)
            path, comments = os.fsdecode(columns[1]), []
        elif columns[0] == b"C":
            comments.append((int(columns[1]), int(columns[2]), [], []))
        elif columns[0] in (b"T", b"O"):
            comments[-1][2 if columns[0] == b"T" else 3].append(tuple(int(it) for it in columns[1:]))
    if path is not None:
        yield (path, comments)
    if process.wait() != 0:
        sys.exit(f"{binary} jsdoc outline: exit code {process.returncode}")


def describe(want, got):
    for index in range(max(len(want), len(got))):
        a = want[index] if index < len(want) else None
        b = got[index] if index < len(got) else None
        if a != b:
            columns = [] if a is None or b is None else [COLUMNS[i] for i in range(len(COLUMNS)) if a[i] != b[i]]
            return f"row {index}: {', '.join(columns)}: the model {a}, the binary {b}"
    return ""


def ask_oxlint(report, oxlint, comments, directory):
    """Each comment before a function of its own, with tag names that are no tags."""
    for first in range(0, len(comments), 20000):
        text, spans = bytearray(), []
        for index, comment in enumerate(comments[first : first + 20000]):
            comment = re.sub(rb"@[A-Za-z]", b"@q", comment)
            spans.append((len(text), len(text) + len(comment)))
            text += comment + b"\nfunction f%d() {}\n" % index
        text = bytes(text)
        with open(os.path.join(directory, "comments.js"), "wb") as out:
            out.write(text)
        arguments = ["--jsdoc-plugin", "-A", "all", "-D", "jsdoc/check-tag-names", "-f", "json", "--threads=1", "comments.js"]
        found = json.loads(subprocess.run([oxlint, *arguments], cwd=directory, capture_output=True).stdout)["diagnostics"]
        found = [it["labels"][0]["span"] for it in found if it.get("code") == "jsdoc(check-tag-names)"]
        found = {(it["offset"], it["offset"] + it["length"]) for it in found}
        expected = set()
        for start, end in spans:
            # `/***/` is none for oxc.
            if any(it != 0x2A for it in text[start + 2 : end - 2]):
                expected |= {(row[0], row[1]) for row in oxc(text, start, end)}
        report.count("tags that oxlint was asked about", by=len(expected))
        for at, end in sorted(found ^ expected):
            start, stop = next(it for it in spans if it[0] <= at < it[1])
            who = "the model only" if (at, end) in expected else "oxlint only"
            report.fail("oxlint and the model of oxc_jsdoc", (who, text[at:end], text[start:stop][:200]))


ASK_TYPESCRIPT = r"""
const ts = require(process.argv[2]);
function flat(tags, depth, out) {
  for (const tag of tags || []) {
    out.push([tag.pos, tag.tagName.end, depth]);
    const type = tag.typeExpression;
    if (!type) continue;
    if (type.kind === ts.SyntaxKind.JSDocTypeLiteral) flat(type.jsDocPropertyTags, depth + 1, out);
    if (type.type && type.type.kind === ts.SyntaxKind.JSDocTypeLiteral) flat(type.type.jsDocPropertyTags, depth + 1, out);
    if (type.kind === ts.SyntaxKind.JSDocSignature) {
      flat(type.parameters, depth + 1, out);
      if (type.type) flat([type.type], depth + 1, out);
    }
  }
}
require("readline").createInterface({ input: process.stdin }).on("line", line => {
  const text = JSON.parse(line), out = [];
  const result = ts.parseIsolatedJSDocComment(text, 0, text.length);
  if (result && result.jsDoc) flat(result.jsDoc.tags, 0, out);
  console.log(JSON.stringify(out.sort((a, b) => a[0] - b[0])));
});
"""


def ask_typescript(report, package, comments, directory):
    comments = [it for it in comments if it.isascii()]
    script = os.path.join(directory, "ask-typescript.js")
    with open(script, "w") as out:
        out.write(ASK_TYPESCRIPT)
    lines = "\n".join(json.dumps(it.decode()) for it in comments)
    answers = subprocess.run(["node", script, os.path.abspath(package)], input=lines, capture_output=True, text=True).stdout.splitlines()
    report.count("comments that TypeScript was asked about", by=len(answers))
    for comment, answer in zip(comments, answers):
        want = [tuple(it) for it in json.loads(answer)]
        got = [(row[0], row[1], row[10]) for row in typescript(comment, 0, len(comment), False)]
        if want != got:
            report.fail("TypeScript and the model of it", (comment[:200], "TypeScript", want, "the model", got))


def main():
    options = {"examples": "8", "fuzz": "0"}
    paths = []
    for argument in sys.argv[1:]:
        if argument.startswith("--"):
            name, _, value = argument[2:].partition("=")
            options[name] = value
        else:
            paths.append(argument)
    report = Report(int(options["examples"]))
    asked, written = [], []
    with tempfile.TemporaryDirectory() as directory:
        if int(options["fuzz"]):
            fuzz_path = os.path.join(directory, "fuzz.js")
            with open(fuzz_path, "wb") as out:
                for index, comment in enumerate(fuzzed(int(options["fuzz"]))):
                    out.write(comment + b"\nfunction f%d() {}\n" % index)
            paths.append(fuzz_path)

        def by_expression():
            for root in paths:
                for path in files_in(root):
                    with open(path, "rb") as file:
                        text = file.read()
                    yield (path, [(*it.span(), None, None) for it in COMMENT.finditer(text) if len(it.group()) >= 5])

        for path, comments in rows_of_binary(options["bin"], paths) if "bin" in options else by_expression():
            with open(path, "rb") as file:
                text = file.read()
            report.count("files")
            for start, end, binary_typescript, binary_oxc in comments:
                report.count("comments")
                by_typescript, by_oxc = typescript(text, start, end), oxc(text, start, end)
                if by_typescript or by_oxc:
                    report.count("comments with tags")
                    asked.append(text[start:end])
                    # What is generated is full of types that are none, which TypeScript parses and the model passes over.
                    if not path.startswith(directory):
                        written.append(text[start:end])
                compare_flavors(report, path, text, start, end, by_typescript, by_oxc)
                if binary_oxc is not None and binary_oxc != by_oxc:
                    report.fail("the binary and the model of oxc_jsdoc", (path, start, describe(by_oxc, binary_oxc)))
                if binary_typescript is not None and binary_typescript != by_typescript:
                    report.fail("the binary and the model of TypeScript", (path, start, describe(by_typescript, binary_typescript)))
        if "oxlint" in options:
            ask_oxlint(report, os.path.abspath(options["oxlint"]), asked, directory)
        if "typescript" in options:
            ask_typescript(report, options["typescript"], written, directory)
    report.print()
    sys.exit(1 if report.failed else 0)


if __name__ == "__main__":
    main()
