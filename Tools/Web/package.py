"""Stage a static web build. The asset index describes byte ranges in the gzip stream."""
import gzip
import hashlib
import json
from pathlib import Path
import shutil
import sys
import tempfile
import tomllib
import zipfile

ENGINE = Path(__file__).resolve().parents[2]
HOST = ENGINE / "Source/Platform/Web"
manifest = Path(sys.argv[1]).resolve()
project = tomllib.loads(manifest.read_text())["project"]
if project.get("kind") == "library":
    sys.exit(0)
build = manifest.parent / project["build_dir"] / "wasm64" / sys.argv[2]
out = build / "site"
out.mkdir(exist_ok=True)
for suffix in (".js", ".wasm"):
    name = project["name"] + suffix
    shutil.copyfile(build / name, out / name)
assets = manifest.parent / "Assets"
extensions = set(sys.argv[3:])
files = sorted(p for p in assets.rglob("*") if p.is_file() and (not extensions or p.suffix.lower() in extensions))
index = []
with tempfile.NamedTemporaryFile(dir=out, delete=False) as tmp:
    with gzip.GzipFile(filename="", mode="wb", fileobj=tmp, mtime=0, compresslevel=4) as pack:
        for path in files:
            index.append([path.relative_to(manifest.parent).as_posix(), path.stat().st_size])
            with path.open("rb") as source:
                shutil.copyfileobj(source, pack)
Path(tmp.name).replace(out / "assets.gz")
(out / "assets.json").write_text(json.dumps(index))
html = (HOST / "shell.html").read_text().replace("@GAME@", project["name"])
shutil.copytree(HOST / "Shaders", out / "Shaders", dirs_exist_ok=True)
for name in ("browser.js", "graphics.js", "shadows.js"):
    shutil.copyfile(HOST / name, out / name)
    if name.endswith(".js"):
        version = hashlib.sha256((out / name).read_bytes()).hexdigest()[:12]
        html = html.replace(f'src="{name}"', f'src="{name}?v={version}"')
(out / (project["name"] + ".html")).write_text(html)
# Static hosts such as itch.io require the entry page to be index.html.
(out / "index.html").write_text(html)
shipped = [project["name"] + suffix for suffix in (".html", ".js", ".wasm")]
shipped += ["index.html", "assets.gz", "assets.json", "browser.js", "graphics.js", "shadows.js"]
shipped += [p.relative_to(out).as_posix() for p in sorted((out / "Shaders").glob("*.wgsl"))]
with zipfile.ZipFile(build / (project["name"] + "-web.zip"), "w", zipfile.ZIP_DEFLATED) as archive:
    for name in shipped:
        # assets.gz is already compressed; deflating it again only costs time.
        archive.write(out / name, name, zipfile.ZIP_STORED if name.endswith(".gz") else zipfile.ZIP_DEFLATED)
# Keep Duck's standard HTML entry point usable from the build directory.
(build / (project["name"] + ".html")).write_text(
    '<!doctype html><script>location.replace("site/" + location.pathname.split("/").pop() + location.search + location.hash)</script>')
print(f"Packaged {len(files)} assets in {out}")
