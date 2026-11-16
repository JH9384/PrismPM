"""Checks the Python bindings `prism-code generate --lang python` writes (#289).

test/generate.test.mjs writes the Calculator package to <root>/calculator_client,
a client over bytes to <root>/echo_client, the answers the real guest gives to
each typed acceptance vector to <root>/cases.json, and the lock's inputs to
<root>/identities.json, then runs this file with `python3 -I -B <this> <root>`.
It prints `ok <cases>` when every check holds.
"""

import json
import sys
from pathlib import Path

root = Path(sys.argv[1])
sys.path.insert(0, str(root))

import calculator_client as c  # noqa: E402
from calculator_client import world  # noqa: E402
from echo_client import Echo  # noqa: E402

cases = json.loads((root / "cases.json").read_text("utf-8"))
inputs = json.loads((root / "identities.json").read_text("utf-8"))
answers = {case["request"]: case["response"] for case in cases}


def guest(request):
    """The real guest's answer to a request the client wrote; a request no vector sends fails."""
    return answers[request.decode("utf-8")].encode("utf-8")


# Every typed vector, through the typed client, as the guest answers it.
calculator = c.Calculator(guest)
for case in cases:
    operation = c.Operation(case["operation"])
    left, right = int(case["left"]), int(case["right"])
    if case["status"] == "ok":
        assert calculator.calculate(operation, left, right) == int(case["value"]), case
    else:
        try:
            calculator.calculate(operation, left, right)
        except c.CalculatorError as error:
            assert error.code == case["value"], case
            assert error.known is c.CalculatorErrorCode(case["value"]), case
        else:
            raise AssertionError(case)
assert calculator.add(20, 22) == 42

# The identities equal the lock's inputs.
model, contract = inputs["model"], inputs["world"]
assert c.MODEL == c.Identity("Calculator", model["blake3"], model["sha256"])
assert tuple(world.WORLD) == (contract["contract"], contract["blake3"], contract["sha256"])
assert world.EXPORTS == ("holo_alloc", "holo_run", "memory")
assert [o.value for o in c.Operation] == ["add", "subtract", "multiply", "divide"]


def answering(text):
    return c.Calculator(lambda request: text.encode("utf-8"))


def refusal(text):
    try:
        answering(text).add(1, 2)
    except c.CalculatorError as error:
        return error
    raise AssertionError(text)


# Refusals carry the code and the model's message; an unknown code is kept as written.
assert refusal("1\terror\tdivision-by-zero").message == "Division by zero."
assert str(refusal("1\terror\tdivision-by-zero")) == "Division by zero. (division-by-zero)"
assert refusal("2\tok\t3").known is c.CalculatorErrorCode.UNSUPPORTED_VERSION
unknown = refusal("1\terror\tnew-code")
assert (unknown.code, unknown.known, unknown.message) == (
    "new-code",
    None,
    "Calculator refused the request.",
)

# An answer the client cannot read is a ResponseError, never a value.
for text in ["1\tok\tthree", "1\tok\t3\textra", "1\tmaybe\t3", "1", "1\tok\t9223372036854775808"]:
    try:
        answering(text).add(1, 2)
    except c.ResponseError:
        pass
    else:
        raise AssertionError(text)

# An operand outside the signed 64-bit range, or not an int, is refused before it is sent.
for bad, kind in [
    (2**63, ValueError),
    (-(2**63) - 1, ValueError),
    (True, TypeError),
    (1.0, TypeError),
]:
    try:
        c.Calculator(lambda request: (_ for _ in ()).throw(AssertionError(request))).add(bad, 0)
    except kind:
        pass
    else:
        raise AssertionError(bad)
try:
    answering("1\tok\t0").calculate("modulo", 1, 2)
except ValueError:
    pass
else:
    raise AssertionError("modulo")


class Reverse:
    """A guest over plain memory that answers each request with its bytes reversed."""

    def __init__(self, memory):
        self.memory = bytearray(memory)

    def holo_alloc(self, length):
        offset = len(self.memory)
        self.memory.extend(bytes(length))
        return offset

    def holo_run(self, offset, length):
        request = bytes(self.memory[offset : offset + length])
        at = self.holo_alloc(length)
        self.write_memory(at, request[::-1])
        return at << 32 | length

    def write_memory(self, offset, data):
        self.memory[offset : offset + len(data)] = data

    def read_memory(self, offset, length):
        if offset + length > len(self.memory):
            raise IndexError("outside memory")
        return bytes(self.memory[offset : offset + length])


# The world's protocol over a Guest, and the client over it.
assert world.dispatch(Reverse(bytes(8)), b"abc") == b"cba"
over_world = c.Calculator(lambda request: world.dispatch(Reverse(b""), guest(request)[::-1]))
assert over_world.divide(-7, 3) == -2

# A model without typed operations gets a client over bytes.
assert Echo(lambda request: request[::-1]).invoke(b"\x01\x02\x03") == b"\x03\x02\x01"

print("ok", len(cases))
