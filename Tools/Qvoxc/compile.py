"""Build adjacent, content-validated QVOXC sidecars using the engine's model parser."""
import argparse
import os
from pathlib import Path
import struct
import subprocess
import tempfile
import zlib

ROOT = Path(__file__).resolve().parents[2]
HEADER = struct.Struct("<4sIII")
SECTION = struct.Struct("<4sII")
VERSION = 1


def current(path, checksum):
    try:
        with path.open("rb") as cache:
            if cache.read(HEADER.size) != HEADER.pack(b"QVXC", VERSION, checksum, 1):
                return False
            tag, length, expected = SECTION.unpack(cache.read(SECTION.size))
            if tag != b"AO01" or length != path.stat().st_size - HEADER.size - SECTION.size:
                return False
            digest = 1
            while block := cache.read(1 << 20):
                digest = zlib.adler32(block, digest)
            return digest == expected
    except (OSError, struct.error):
        return False


def compile_model(path, compiler):
    cache = path.with_suffix(".qvoxc")
    source = path.read_bytes()
    checksum = zlib.adler32(source)
    if current(cache, checksum):
        return False
    # Bake a snapshot so the checksum and the payload always describe the same input.
    with tempfile.TemporaryDirectory(dir=cache.parent) as scratch:
        tmp = Path(scratch)
        model = tmp / "source.qvox"
        model.write_bytes(source)
        payload = tmp / "ao"
        result = subprocess.run([compiler, model, payload], capture_output=True, text=True)
        if result.returncode or result.stdout.strip() != "QVOXC complete":
            raise ValueError(f"{path}: {result.stdout.strip()} {result.stderr.strip()}")
        data = payload.read_bytes()
        staged = tmp / "model.qvoxc"
        with staged.open("wb") as output:
            output.write(HEADER.pack(b"QVXC", VERSION, checksum, 1))
            output.write(SECTION.pack(b"AO01", len(data), zlib.adler32(data)))
            output.write(data)
        os.replace(staged, cache)
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("assets", type=Path)
    parser.add_argument("--duck-root", type=Path, default=ROOT.parent / "Duck")
    args = parser.parse_args()
    builder = args.duck_root.resolve() / "duck.cmd"
    subprocess.run([builder, "build", ROOT / "Tools/Qvoxc/Qvoxc.dkp", "--profile", "release"], check=True)
    compiler = ROOT / ".duck/qvoxc/release/Qvoxc.exe"
    files = sorted(args.assets.rglob("*.qvox")) if args.assets.is_dir() else [args.assets]
    changed = sum(compile_model(path, compiler) for path in files)
    print(f"QVOXC: {changed} compiled, {len(files)-changed} current")


if __name__ == "__main__":
    main()
