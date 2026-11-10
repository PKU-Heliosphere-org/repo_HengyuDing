"""Download the two fixed public NAIF kernels used by ORBIT; never runs at playback."""
import hashlib
import json
from pathlib import Path
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
DIRECTORY = ROOT / "data" / "ephemeris"
SOURCES = {
    "de440s.bsp": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/spk/planets/de440s.bsp",
    "pck00011.tpc": "https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc",
}


def main():
    DIRECTORY.mkdir(parents=True, exist_ok=True)
    manifest = {}
    for name, url in SOURCES.items():
        target = DIRECTORY / name
        if not target.exists():
            temporary = DIRECTORY / (name + ".part")
            print("Downloading", name, flush=True)
            with urllib.request.urlopen(url, timeout=120) as response, temporary.open("wb") as out:
                expected = response.headers.get("Content-Length")
                while chunk := response.read(1024 * 1024):
                    out.write(chunk)
            if expected and temporary.stat().st_size != int(expected):
                raise RuntimeError("Incomplete download: " + name)
            signature = temporary.read_bytes()[:8]
            if (name.endswith(".bsp") and not signature.startswith(b"DAF/SPK")) or (name.endswith(".tpc") and not signature.startswith(b"KPL/PCK")):
                raise RuntimeError("Unexpected kernel format: " + name)
            temporary.replace(target)
        manifest[name] = {"url": url, "bytes": target.stat().st_size, "sha256": hashlib.sha256(target.read_bytes()).hexdigest()}
        print(name, manifest[name]["bytes"], "bytes", flush=True)
    (DIRECTORY / "manifest.json").write_text(json.dumps(manifest, indent=2)+"\n", encoding="utf-8")
    print("Kernels ready:", DIRECTORY)


if __name__ == "__main__":
    main()
