"""Check build artifacts and diagnostics that require invoking the Duck builder."""
import argparse
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument("--builder", type=Path)
args, rest = parser.parse_known_args()
if args.builder:
    BUILDER = args.builder.resolve()
else:
    duck = ROOT.parent / "Duck"
    candidates = [duck / "build/Debug/duck.exe", duck / "build/Release/duck.exe", duck / "build/duck"]
    BUILDER = next((path for path in candidates if path.is_file()), None)
    if BUILDER is None:
        parser.error("build Duck first, or supply --builder")

class PlatformTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="quaxel platform & ")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def run_build(self, references, source, dependencies, profile="debug", success=True):
        (self.root / "main.dk").write_text(source, encoding="utf-8")
        references = ", ".join('"' + Path(ref).as_posix() + '"' for ref in references)
        dependencies = ", ".join('"' + dep + '"' for dep in dependencies)
        manifest = self.root / "probe.dkp"
        manifest.write_text(f'version = 1\nreferences = [{references}]\n'
                            '[project]\nname = "Probe"\nentry = "probe"\n'
                            '[modules.probe]\nsources = ["main.dk"]\n'
                            f'depends = [{dependencies}]\n', encoding="utf-8")
        result = subprocess.run([str(BUILDER), "build", str(manifest), "--profile", profile],
                                capture_output=True, text=True, timeout=60)
        self.assertEqual(result.returncode == 0, success, result.stdout + result.stderr)
        return result

    def test_core_has_no_platform_dependency(self):
        self.run_build([ROOT / "Quaxel.dkp"], """Main() {
            Print(Quaxel.ApiVersion())
            QuaxelSession session()
            session.Begin()
            session.Advance()
            session.Stop()
            Print(session.Frame)
            Print(session.Running)
        }""", ["quaxel_core"])
        self.assertFalse((self.root / ".duck/build/debug/quaxel_platform.o").exists())

    def test_headless(self):
        for profile in ("debug", "release"):
            result = self.run_build([ROOT / "Quaxel.Headless.dkp"], "Main() { Print(QuaxelPlatform.SupportsWindowing()) }",
                                    ["quaxel_platform"], profile)
            self.assertNotIn("Kernel32", result.stdout)
            self.assertNotIn("Source\\Platform\\Windows", result.stdout)
            ir = (self.root / ".duck/build" / profile / "quaxel_platform_backend.ll").read_text()
            self.assertNotIn("QueryPerformance", ir)

    def test_consumers_cannot_bypass_api(self):
        for source, dependencies in [
            ("Main() { Print(QuaxelPlatform.SupportsWindowing()) }", ["quaxel_core"]),
            ("Main() { Print(QuaxelPlatformBackend.SupportsWindowing()) }", ["quaxel_platform"]),
            ("Main() { long n = 0\nQuaxelWindowsNative.QueryPerformanceCounter(n) }", ["quaxel_platform"]),
        ]:
            backend = "Quaxel.Windows.dkp" if os.name == "nt" else "Quaxel.Headless.dkp"
            result = self.run_build([ROOT / backend], source, dependencies, success=False)
            self.assertIn("unknown function", result.stderr)

    def mock_backend(self, body):
        (self.root / "mock.dk").write_text(body)
        manifest = self.root / "mock.dkp"
        manifest.write_text('version = 1\n[project]\nname = "MockPlatform"\nkind = "library"\n'
                            '[modules.quaxel_platform]\n'
                            f'sources = ["{(ROOT / "Source/Platform/Api/Platform.dk").as_posix()}"]\n'
                            'depends = ["quaxel_platform_backend"]\n'
                            '[modules.quaxel_platform_backend]\nsources = ["mock.dk"]\n')
        return manifest

    def test_missing_backend_method_is_compile_error(self):
        manifest = self.mock_backend('QuaxelPlatformBackend #{ bool SupportsWindowing() { return false } }')
        result = self.run_build([manifest], "Main() {}", ["quaxel_platform"], success=False)
        self.assertIn("unknown function", result.stderr)

    def test_two_backends_are_rejected(self):
        result = self.run_build([ROOT / "Quaxel.Headless.dkp", ROOT / "Quaxel.Windows.dkp"],
                                "Main() {}", ["quaxel_platform"], success=False)
        self.assertIn("duplicate module", result.stderr)


if __name__ == "__main__":
    unittest.main(argv=[__file__, *rest])
