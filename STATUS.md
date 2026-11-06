# Status

Where the project is up to. Last updated 2026-11-06.

## Done

- Extension written: `src/` (extension.js, prefs.js, lib/sun.js,
  lib/schedule.js, schema, metadata). GNOME 49–51, UUID
  `dynamic-wallpaper@eusebiuxii.com`.
- Features:
  - day/night wallpapers, switched at sunrise/sunset or at set times;
  - optional sunrise/sunset wallpapers (default 60 min);
  - city search (offline, libgweather) or coordinates by hand;
  - optional light/dark style switch, off by default;
  - keeps running on the lock screen (`unlock-dialog`);
  - re-checks on wake from sleep;
  - only changes the wallpaper when the phase changes.
- Tests: `make test`, 14 passing in several time zones. Sun times are
  within 1–3 minutes of published values.
- Settings window checked with `make prefs` and screenshots (both pages,
  city search, set-times mode).
- extension.js exercised outside GNOME Shell with a stub base class and
  memory settings: applies phases, style switch, leaves manual picks,
  disable() cleans up.
- `make pack` builds a valid zip.
- Guides in `docs/` (1–4) and README.

## Not done yet

- Not yet run inside a real GNOME Shell: next step is `make link`, log out
  and in, and enable it (or `make nested`, see docs/3).
- Check the name "Dynamic Wallpaper" isn't taken on extensions.gnome.org.

## Ideas

- "Use my current location" (Geoclue).
- Pick a light/dark pair from GNOME Settings as day/night.
- Cross-fade between wallpapers.
- Translations.
