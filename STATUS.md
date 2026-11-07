# Status

Where the project is up to. Last updated 2026-11-07.

## Done

- Extension written: `src/` (extension.js, prefs.js, dynamicSetPage.js,
  lib/sun.js, lib/schedule.js, lib/slideshow.js, lib/dynamicSet.js,
  schema, metadata). GNOME 49–51, UUID `dynamic-wallpaper@eusebiuxii.com`.
- Settings window tabs, in order: **Wallpapers · Dynamic set · Theme ·
  Schedule**.
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
  - **Dynamic set tab**: any number of pictures on a 24-hour rounded-square
    clock (docs/5-dynamic-set.md):
    - by time of day (drag snaps to 15 min; exact minutes in the middle
      panel) or by sun (17 labels: 12 day, 5 night; the dot follows the
      pointer and snaps onto a label within 8 min, otherwise saved as
      label ± minutes, so it follows the seasons);
    - track coloured by the sun's height; label ticks dark/light to match
      the track; hour labels every 3 h; picture times outside the track;
      drag tag ("Dusk · 17:04", accent colour when snapped);
    - optional picture folder (thumbnail grid when adding), preview-date
      slider, "space evenly", fade length;
  - Wallpapers and Dynamic set tabs grey out whichever isn't in use
    (banner + "Use these instead" on Wallpapers);
  - **Theme tab**: optional light/dark style switch, off by default, with
    its own schedule: sunset → sunrise, dusk → dawn, or set times;
  - Schedule tab's **Today** list: thumbnail, label, times and "Now" for
    each wallpaper, for whichever is in use;
  - keeps running on the lock screen (`unlock-dialog`);
  - re-checks on wake from sleep;
  - only changes the wallpaper/style when they need to change.
- Tests: `make test`, 48 passing. One older sun test ("New York,
  midsummer") fails when the computer's time zone is far east (Tokyo,
  Sydney); this is a quirk of the test, not the maths. Sun times are
  within 1–3 minutes of published values.
- Settings window checked with screenshots (`tests/prefs-window.js`, now
  with `--select`, `--size`, `--scroll-end`) and simulated clicks/drags.
- extension.js exercised outside GNOME Shell with a stub base class and
  memory settings: day/night, dynamic set slideshow, theme switching.
- First version ran fine in a real GNOME 51 session (Fedora 45 laptop).
  Also installed on the Fedora 43 / GNOME 49 desktop (`make link`); its
  settings window checked there too (before the dynamic set existed).
- `make pack` builds a valid zip (includes dynamicSetPage.js).
- Guides in `docs/` (1–5) and README.

## Where we left off (2026-11-07, evening)

- Committed and pushed up to `b7ae1e4` (dynamic set tab). **Not committed
  yet:** greying out the unused tab, the Theme tab (style moved off the
  Wallpapers tab, own schedule keys `style-mode`, `style-day-start`,
  `style-night-start`), tab order, and these notes.
- About to log out and in on the laptop for the first real test of the
  slideshow wallpaper, the dynamic set, and the Theme tab's switching.
- Open question: commit `726045b` (already pushed) has a personal email as
  author. Fixing it means rewriting that commit and force-pushing `main`;
  not done, waiting for a yes.

## Not done yet

- Real-session test (after logging in again):
  - `gsettings get org.gnome.desktop.background picture-uri` should point
    at `~/.local/share/dynamic-wallpaper/schedule-*.xml`, and the right
    picture should show straight away;
  - dynamic set by hand: adding, dragging in both modes, removing, the
    folder grid, and the wallpaper changing through a day;
  - Theme tab switching at the right time.
- Usability ideas from the review, not done yet (most useful first):
  thumbnails inside the dots; undo after removing; keyboard nudging
  (arrows/Delete/Tab); handling dots that overlap; a "play the day"
  preview; a reminder when pictures are set up but the set is off; marking
  missing image files; an opt-in "add all from folder".
- Light/dark style is still switched by the extension, so with it on the
  style may change a moment after login.
- Check the name "Dynamic Wallpaper" isn't taken on extensions.gnome.org.
- Check the new tabs on the GNOME 49 desktop (Adw.ToggleGroup needs
  libadwaita 1.7+; GNOME 49 has 1.8).

## Ideas

- Automatic placement of folder pictures (file-name times/words, brightness).
- Import Apple `.heic` dynamic wallpapers into a set.
- Write the set's slideshow file once a day instead of at every change.
- "Use my current location" (Geoclue).
- Pick a light/dark pair from GNOME Settings as day/night.
- Translations.
