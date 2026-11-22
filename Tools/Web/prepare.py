"""Include the shared shaders in the source Duck fingerprints for the wasm link."""
from pathlib import Path
import re
import tempfile

engine = Path(__file__).resolve().parents[2]
source = engine / "Source/Platform/Web/Effects.cpp"
output = engine / ".duck/web/Effects.cpp"
text = re.sub(r'^#include "([^"]+\.glsl)"', lambda m: (source.parent / m[1]).read_text(),
              source.read_text(), flags=re.MULTILINE)
if not output.exists() or output.read_text() != text:
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", dir=output.parent, delete=False) as tmp:
        tmp.write(text)
    Path(tmp.name).replace(output)
