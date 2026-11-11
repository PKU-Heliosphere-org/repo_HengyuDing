import socket
import sys
from types import SimpleNamespace
from urllib.request import urlopen
from urllib.parse import urlparse

import pytest

from orbit.desktop import local_server, run_desktop


def assert_stopped(url):
    with socket.socket() as probe:
        probe.settimeout(1)
        assert probe.connect_ex(("127.0.0.1", urlparse(url).port)) != 0


def test_local_server_is_ready_and_stops_on_error():
    url = None
    with pytest.raises(RuntimeError, match="simulated window failure"):
        with local_server() as url:
            with urlopen(url + "/api/v1/health", timeout=5) as response:
                assert response.status == 200
            raise RuntimeError("simulated window failure")
    assert_stopped(url)


def test_occupied_port_does_not_attach_to_or_stop_existing_session():
    with local_server() as url:
        with pytest.raises(RuntimeError, match="Cannot open local port"):
            with local_server(urlparse(url).port):
                pytest.fail("Must not reuse another service")
        with urlopen(url + "/api/v1/health", timeout=5) as response:
            assert response.status == 200
    assert_stopped(url)


@pytest.mark.parametrize("fail", [False, True])
def test_window_lifetime_owns_service_and_downloads_are_enabled(monkeypatch, fail):
    observed = {}

    def create_window(title, url, **options):
        observed.update(url=url, title=title)
        with urlopen(url + "/api/v1/health", timeout=5) as response:
            assert response.status == 200

    def start(**options):
        assert options["gui"] == "edgechromium"
        assert str(options["storage_path"]).endswith("webview2")
        assert fake.settings["ALLOW_DOWNLOADS"] is True
        if fail:
            raise RuntimeError("simulated renderer failure")

    fake = SimpleNamespace(settings={}, create_window=create_window, start=start)
    monkeypatch.setitem(sys.modules, "webview", fake)
    if fail:
        with pytest.raises(RuntimeError, match="WebView2"):
            run_desktop()
    else:
        run_desktop()
    assert observed["title"] == "ORBIT"
    assert_stopped(observed["url"])
