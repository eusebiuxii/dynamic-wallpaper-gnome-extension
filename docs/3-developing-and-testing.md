# 3. Developing and testing

Every command here has a `make` shortcut. Run `make help` to see them.

## The catch on Wayland

GNOME Shell only loads an extension's code **when it starts**. On X11 you
could restart the shell in place (Alt + F2, `r`). Fedora uses Wayland, and
there GNOME Shell *is* your session, so restarting it means logging out.

That gives you three ways to test, from quickest to most real:

| What you changed | How to test it | Log out? |
| --- | --- | --- |
| `lib/` (sun maths, scheduling) | `make test` | no |
| `prefs.js` (settings window) | `make prefs` | no |
| `extension.js` | `make nested` (a test GNOME in a window) | no |
| Final check of everything | `make link`, then log out and in | yes |

## 1. Tests: `make test`

```bash
make test
```

This runs `tests/run.js` with `gjs`. It checks the sunrise and sunset maths
against known times, and the scheduling against tricky cases (just after
midnight, short days, nights starting after midnight, polar day).

To add a test, open `tests/schedule.test.js` and copy one:

```js
test('what it should do', () => {
    assertEqual(getPhase(at(7, 30), fixedWithTransitions).phase, Phase.SUNRISE);
});
```

Times depend on your time zone, so to be sure, run the tests in a few:

```bash
TZ=Pacific/Auckland make test
TZ=America/Los_Angeles make test
```

## 2. The settings window: `make prefs`

```bash
make prefs
```

This opens the real settings window straight from `src/`, without
installing anything. It uses **throwaway settings** (kept in memory), so
nothing you click touches your real setup. Close it, edit `prefs.js`, run it
again.

Options (run the script directly to use them):

```bash
GSETTINGS_BACKEND=memory GI_TYPELIB_PATH=/usr/lib64/gnome-shell/girepository-1.0 \
LD_LIBRARY_PATH=/usr/lib64/gnome-shell \
  gjs -m tests/prefs-window.js --page schedule --set "mode='fixed'" --search york
```

- `--page wallpapers|schedule`: which page to open on
- `--set key=value`: start with a setting changed (value in GVariant format:
  `true`, `120`, `'text'`)
- `--search text`: type into the city search
- `--screenshot file.png`: save a picture of the window and close it

`make prefs-real` does the same with your real settings.

Once the extension is installed, `gnome-extensions prefs
dynamic-wallpaper@eusebiuxii.com` opens the settings the normal way.

## 3. A test GNOME in a window: `make nested`

This starts a **second, separate GNOME Shell inside a window** on your
desktop, with your extensions loaded. It's the safe way to test
`extension.js`: if it crashes, only the window closes.

One-time setup (GNOME 49 and later need this package for it):

```bash
sudo dnf install mutter-devkit
```

Then:

```bash
make nested
```

In the window, open a terminal and enable the extension:

```bash
gnome-extensions enable dynamic-wallpaper@eusebiuxii.com
```

After changing `extension.js`, close the window and run `make nested` again.

`make nested` runs `make link` first (see the next section), so the test
shell finds the extension.

## 4. Installing it for real

### For development: `make link`

```bash
make link
```

This makes `~/.local/share/gnome-shell/extensions/dynamic-wallpaper@eusebiuxii.com`
a **link** to your `src/` folder, so GNOME runs your working copy directly.
Log out and back in once so GNOME notices it, then:

```bash
gnome-extensions enable dynamic-wallpaper@eusebiuxii.com
```

From then on, after editing:

- **prefs.js:** close and reopen the settings window. If you still see the
  old version, run `pkill -f org.gnome.Shell.Extensions` first.
- **extension.js:** log out and back in (or test in `make nested`).
- **The schema:** run `make schemas`, then log out and back in.

`make unlink` removes the link.

### Like a user would: `make install`

```bash
make install
```

This builds the zip (see guide 4) and installs it with `gnome-extensions
install`, exactly how someone downloading it would. Use it as a last check
before releasing. Run `make unlink` first if you used `make link`, since
they're the same folder.

## If something goes wrong

An error in an extension normally just stops that extension: GNOME carries
on and shows the error in the Extensions app. In the rare case GNOME Shell
itself crashes, you're logged out. Either way:

- **Turn it off:** `gnome-extensions disable dynamic-wallpaper@eusebiuxii.com`
- **Remove it completely,** even if the desktop won't start: press
  **Ctrl + Alt + F3**, log in, and run:

  ```bash
  rm ~/.local/share/gnome-shell/extensions/dynamic-wallpaper@eusebiuxii.com
  ```

  With `make link` that's only a link, so your code is untouched. Press
  **Ctrl + Alt + F2** (or F1) to get back to the login screen.
- **Get your old wallpaper back:** `backup-wallpaper-settings.dconf` in the
  project folder (not in git) has the wallpaper and style from before the
  extension was installed:

  ```bash
  dconf load /org/gnome/desktop/ < backup-wallpaper-settings.dconf
  ```

## Seeing errors

### The log

Everything GNOME Shell prints, including your extension's errors and any
`console.log()` you add, goes to the system log:

```bash
make logs                                   # only lines mentioning this extension
journalctl -f -o cat /usr/bin/gnome-shell   # everything from GNOME Shell
```

For the settings window, errors print in the terminal you ran `make prefs`
from.

### The Extensions app

If the extension fails to load, the **Extensions** app (or Extension
Manager) shows it with an error message. Click it to see the error.

### Looking Glass

GNOME Shell's built-in debugger. Press **Alt + F2**, type `lg`, press
Enter.

- **Extensions** tab: each extension's state, and its error if it failed.
- **Evaluator** tab: run JavaScript inside GNOME Shell. For example,
  `global.display.get_n_monitors()`.

Press Escape to close it.

### Checking the settings live

Watch the settings change as you use the settings window:

```bash
dconf watch /org/gnome/shell/extensions/dynamic-wallpaper/
```

And watch the wallpaper being set:

```bash
dconf watch /org/gnome/desktop/background/
```

## Testing the schedule without waiting all day

Use set times a minute or two from now:

1. Open the settings, choose **At set times**, and set _Night starts_ to two
   minutes from now.
2. Run `make logs` or `dconf watch /org/gnome/desktop/background/`.
3. The wallpaper should change at that minute, give or take a second.

To test waking from sleep, set the change for a time while the laptop will
be suspended, then wake it. It should switch within a second or two of
waking.

## Common problems

| Symptom | Likely cause |
| --- | --- |
| Extension not listed after `make link` | GNOME only scans for new extensions at login; log out and in |
| "Error" in the Extensions app | A JavaScript error while loading. The message says which file and line |
| `GLib.Error … schema … not installed` | Schema not compiled: `make schemas` |
| Changes to extension.js not showing | Shell still running the old code: log out and in, or `make nested` |
| Settings window shows old code | `pkill -f org.gnome.Shell.Extensions`, then reopen |
| Wallpaper doesn't change | No image set for that phase, or check `make logs` for errors |
