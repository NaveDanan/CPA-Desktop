"""Run under dbus-run-session with Python GI and a graphical Linux session.

python3 test/linux-desktop.smoke.py /absolute/path/to/CPA.AppImage
Uses isolated XDG directories and a private StatusNotifier watcher.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from gi.repository import Gio, GLib

image = Path(sys.argv[1]).resolve()
root = Path(tempfile.mkdtemp(prefix="cpa-desktop-login-"))
profile = root / "profile"
profile.mkdir()
environment = dict(os.environ, XDG_CONFIG_HOME=str(root / "config"),
                   XDG_DATA_HOME=str(root / "data"), APPIMAGE_EXTRACT_AND_RUN="1")
# The normal and simulated login launch must use identical XDG locations.
os.environ.update(environment)
connection = Gio.bus_get_sync(Gio.BusType.SESSION, None)
watcher_name = "org.kde.StatusNotifierWatcher"
watcher_path = "/StatusNotifierWatcher"
items = []
interface = Gio.DBusNodeInfo.new_for_xml("""
<node><interface name="org.kde.StatusNotifierWatcher">
<method name="RegisterStatusNotifierItem"><arg type="s" direction="in"/></method>
<method name="RegisterStatusNotifierHost"><arg type="s" direction="in"/></method>
<property name="RegisteredStatusNotifierItems" type="as" access="read"/>
<property name="IsStatusNotifierHostRegistered" type="b" access="read"/>
<property name="ProtocolVersion" type="i" access="read"/>
<signal name="StatusNotifierItemRegistered"><arg type="s"/></signal>
</interface></node>""").interfaces[0]


def method(conn, sender, obj, iface, name, parameters, invocation):
    if name == "RegisterStatusNotifierItem":
        value = parameters.unpack()[0]
        item = (sender, value) if value.startswith("/") else (value, "/StatusNotifierItem")
        items.append(item)
        invocation.return_value(None)
        conn.emit_signal(None, watcher_path, watcher_name, "StatusNotifierItemRegistered",
                         GLib.Variant("(s)", (item[0] + item[1],)))
    else:
        invocation.return_value(None)


def get_property(conn, sender, obj, iface, name):
    if name == "RegisteredStatusNotifierItems":
        return GLib.Variant("as", [service + obj for service, obj in items])
    return GLib.Variant("b", True) if name == "IsStatusNotifierHostRegistered" else GLib.Variant("i", 0)


connection.register_object(watcher_path, interface, method, get_property, None)
connection.call_sync("org.freedesktop.DBus", "/org/freedesktop/DBus", "org.freedesktop.DBus",
                     "RequestName", GLib.Variant("(su)", (watcher_name, 0)), None, 0, 5000, None)
loop = GLib.MainLoop()
threading.Thread(target=loop.run, daemon=True).start()


def wait(predicate, description, timeout=45):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(0.1)
    raise AssertionError(description + "; logs: " + str(root))


def call(service, obj, iface, name, parameters=None):
    return connection.call_sync(service, obj, iface, name, parameters, None, 0, 10000, None).unpack()


def unpack(value):
    if isinstance(value, GLib.Variant):
        return unpack(value.unpack())
    if isinstance(value, (list, tuple)):
        return [unpack(item) for item in value]
    if isinstance(value, dict):
        return {key: unpack(item) for key, item in value.items()}
    return value


def menu_item(node, label):
    identifier, properties, children = node
    if properties.get("label", "").replace("_", "") == label:
        return identifier
    for child in children:
        found = menu_item(child, label)
        if found is not None:
            return found
    return None


def invoke_menu(item, label):
    service, obj = item
    menu = unpack(call(service, obj, "org.freedesktop.DBus.Properties", "Get",
                       GLib.Variant("(ss)", ("org.kde.StatusNotifierItem", "Menu"))))[0]
    layout = unpack(call(service, menu, "com.canonical.dbusmenu", "GetLayout",
                         GLib.Variant("(iias)", (0, -1, []))))[1]
    identifier = menu_item(layout, label)
    assert identifier is not None, "Missing tray menu action: " + label
    call(service, menu, "com.canonical.dbusmenu", "Event",
         GLib.Variant("(isvu)", (identifier, "clicked", GLib.Variant("s", ""), 0)))


def proxy_alive():
    try:
        if not (profile / "desktop-secrets.json").exists():
            return False
        key = json.loads((profile / "desktop-secrets.json").read_text())["managementKey"]
        request = urllib.request.Request("http://127.0.0.1:19517/v8/management/config",
                                         headers={"Authorization": "Bearer " + key})
        with urllib.request.urlopen(request, timeout=1) as response:
            return response.status == 200
    except (OSError, urllib.error.URLError):
        return False


(root / "import.yaml").write_text("port: 19517\nauth-dir: " + str(root / "empty-auths") + "\n")
log = (root / "appimage.log").open("w")
child = subprocess.Popen([str(image), "--no-sandbox", "--disable-gpu", "--background",
                          "--user-data-dir", str(profile), "--import-config", str(root / "import.yaml")],
                         env=environment, stdout=log, stderr=subprocess.STDOUT)
try:
    wait(lambda: len(items) >= 1 and proxy_alive(), "Normal AppImage launch did not register a tray")
    entry = root / "config/autostart/io.cliproxy.desktop.desktop"
    launcher = root / "data/applications/io.cliproxy.desktop.desktop"
    assert entry.exists() and launcher.exists(), "AppImage did not register login and application launchers"
    assert str(image) in entry.read_text(), "Login entry must use the persistent AppImage"
    assert ".mount_" not in entry.read_text() and "appimage_extracted_" not in entry.read_text()
    assert "--background" in entry.read_text() and "--background" not in launcher.read_text()
    assert Gio.DesktopAppInfo.new_from_filename(str(launcher)), "Application drawer entry is invalid"
    original_secrets = (profile / "desktop-secrets.json").read_bytes()
    invoke_menu(items[-1], "Open CPA-Desktop")
    assert proxy_alive(), "Opening from the tray must retain the running proxy"
    invoke_menu(items[-1], "Quit CPA-Desktop")
    child.wait(timeout=20)
    wait(lambda: not proxy_alive(), "Quit did not stop the proxy", 10)
    # Launch exactly the generated login entry through the desktop's own parser.
    count = len(items)
    stdout, stderr = os.dup(1), os.dup(2)
    try:
        os.dup2(log.fileno(), 1)
        os.dup2(log.fileno(), 2)
        Gio.DesktopAppInfo.new_from_filename(str(entry)).launch([], None)
    finally:
        os.dup2(stdout, 1)
        os.dup2(stderr, 2)
        os.close(stdout)
        os.close(stderr)
    wait(lambda: len(items) > count and proxy_alive(), "Desktop login entry did not restart CPA")
    assert (profile / "desktop-secrets.json").read_bytes() == original_secrets, "Login restart changed the saved profile"
    invoke_menu(items[-1], "Quit CPA-Desktop")
    wait(lambda: not proxy_alive(), "Quit after login did not stop the proxy", 10)
    result = {"passed": True, "checks": ["first launch registration", "application drawer entry",
              "persistent AppImage path", "native StatusNotifier tray", "tray Open and Quit",
              "desktop login entry restart", "same saved profile"], "artifacts": str(root)}
    (root / "result.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result, indent=2))
finally:
    if child.poll() is None:
        child.terminate()
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            child.kill()
    loop.quit()
    log.close()
