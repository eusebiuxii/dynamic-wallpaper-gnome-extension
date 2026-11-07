# Status

Where the project is up to. Last updated 2026-11-07.

## Done

- Extension written: `src/` (extension.js, prefs.js, lib/sun.js,
  lib/schedule.js, lib/slideshow.js, schema, metadata). GNOME 49–51, UUID
  `dynamic-wallpaper@eusebiuxii.com`.
- Features:
  - day/night wallpapers, switched at sunrise/sunset or at set times;
  - optional sunrise/sunset wallpapers: N minutes from dawn, and N minutes
    up to dusk (civil twilight, default N = 60);
  - city search (offline, libgweather) or coordinates by hand;
  - wallpaper is a GNOME slideshow file the extension rewrites at each
    change, so the right picture shows from the first frame at login
    (before, the previous wallpaper showed for a moment, then swapped);
  - fades between wallpapers, length chosen by the user (default 15 min,
    0 = instant);
  - optional light/dark style switch, off by default;
  - keeps running on the lock screen (`unlock-dialog`);
  - re-checks on wake from sleep;
  - only changes the wallpaper when the phase changes;
  - **Dynamic set tab** (2026-11-07): any number of pictures on a 24-hour
    rounded-square clock, scheduled by time of day or by sun labels (dawn …
    midnight) that follow the seasons. Optional picture folder. Details in
    docs/5-dynamic-set.md.
- Tests: `make test`, 44 passing. One older sun test ("New York,
  midsummer") fails when the computer's time zone is far east (Tokyo,
  Sydney); this is a quirk of the test, not the maths. Sun times are
  within 1–3 minutes of published values.
- Settings window checked with `make prefs` and screenshots (both pages,
  city search, set-times mode).
- extension.js exercised outside GNOME Shell with a stub base class and
  memory settings: applies phases, style switch, leaves manual picks,
  disable() cleans up.
- First version ran fine in a real GNOME 51 session (Fedora 45 laptop).
  Also installed on the Fedora 43 / GNOME 49 desktop (`make link`); its
  settings window checked there too.
- `make pack` builds a valid zip.
- Guides in `docs/` (1–4) and README.

## Not done yet

- Dynamic set: checked with screenshots, simulated clicks/drags, and
  extension.js run outside the Shell. Needs trying for real: adding, dragging
  and removing by hand, the folder grid, and the wallpaper changing through
  a day. Waiting on feedback.

- The slideshow version has been checked with GNOME's own slideshow reader
  (GnomeBG) and extension.js run outside the Shell, but not yet in a
  real session: log out and in, check the wallpaper is right straight away.
- Light/dark style is still switched by the extension, so with that option
  on the style may change a moment after login.
- Check the name "Dynamic Wallpaper" isn't taken on extensions.gnome.org.

## Ideas

- "Use my current location" (Geoclue).
- Pick a light/dark pair from GNOME Settings as day/night.
- Translations.
