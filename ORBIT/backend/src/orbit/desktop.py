"""Own a loopback server for exactly the lifetime of the desktop window."""

import argparse
from contextlib import contextmanager
from pathlib import Path
import socket
import sys
import threading
import time
import webbrowser

import uvicorn

ROOT = Path(__file__).resolve().parents[3]


@contextmanager
def local_server(port=0, timeout=30):
    # Bind before launching the worker: never attach to or stop another session.
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server = None
    worker = None
    errors = []
    try:
        try:
            listener.bind(("127.0.0.1", port))
        except OSError as exc:
            raise RuntimeError(
                f"Cannot open local port {port}. Close the other session or use -Port 0."
            ) from exc
        selected_port = listener.getsockname()[1]
        server = uvicorn.Server(uvicorn.Config(
            "orbit.app:app", host="127.0.0.1", port=selected_port,
            access_log=False, log_level="warning", timeout_graceful_shutdown=5,
        ))

        def serve():
            try:
                server.run(sockets=[listener])
            except BaseException as exc:
                errors.append(exc)

        worker = threading.Thread(target=serve, name="orbit-server", daemon=True)
        worker.start()
        deadline = time.monotonic() + timeout
        while not server.started:
            if not worker.is_alive():
                raise RuntimeError("ORBIT local service failed to start.") from (errors[0] if errors else None)
            if time.monotonic() >= deadline:
                raise RuntimeError("ORBIT local service did not become ready in time.")
            time.sleep(0.025)
        yield f"http://127.0.0.1:{selected_port}"
    finally:
        if server is not None:
            server.should_exit = True
        if worker is not None:
            worker.join(timeout=7)
        listener.close()


def run_desktop(port=0, debug=False):
    try:
        import webview
    except ImportError as exc:
        raise RuntimeError(
            "Desktop dependencies are missing. Run scripts/setup.ps1, or "
            ".venv/Scripts/python.exe -m pip install -e backend."
        ) from exc

    # Project JSON and PNG use Blob downloads; pywebview disables them by default.
    webview.settings["ALLOW_DOWNLOADS"] = True
    webview.settings["OPEN_DEVTOOLS_IN_DEBUG"] = False
    profile = ROOT / ".cache" / "webview2"
    profile.mkdir(parents=True, exist_ok=True)
    with local_server(port) as url:
        print(f"ORBIT desktop: {url}", flush=True)
        webview.create_window(
            "ORBIT", url, width=1440, height=900, min_size=(1024, 720),
            background_color="#0b1016", text_select=True,
        )
        # Force WebView2: the legacy IE fallback cannot render our WebGL2 scene.
        try:
            webview.start(
                gui="edgechromium", debug=debug, storage_path=str(profile),
                private_mode=False,
            )
        except Exception as exc:
            raise RuntimeError(
                "Cannot open the desktop window. Ensure Microsoft Edge WebView2 "
                "Runtime is installed. Browser fallback: scripts/start.ps1 -Browser. "
                f"Details: {exc}"
            ) from exc


def main(argv=None):
    parser = argparse.ArgumentParser(description="Launch the ORBIT desktop window")
    parser.add_argument("--port", type=int, default=0, help="Local port; 0 selects a free port")
    parser.add_argument("--browser", action="store_true", help="Open a browser instead of a desktop window")
    parser.add_argument("--debug", action="store_true", help="Enable desktop debugging")
    args = parser.parse_args(argv)
    if not 0 <= args.port <= 65535:
        parser.error("port must be between 0 and 65535")
    if not (ROOT / "frontend" / "dist" / "index.html").is_file():
        print("Frontend is not built. Run scripts/setup.ps1 first.", file=sys.stderr)
        return 1
    try:
        if args.browser:
            with local_server(args.port) as url:
                print(f"ORBIT browser: {url} (Ctrl+C to stop)", flush=True)
                webbrowser.open(url)
                while True:
                    time.sleep(0.25)
        else:
            run_desktop(args.port, args.debug)
    except KeyboardInterrupt:
        pass
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
