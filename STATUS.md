# Status

Where the project is up to. Last updated 2026-11-07.

## Done

- Extension written: `src/` (extension.js, prefs.js, dynamicSetPage.js,
  lib/sun.js, lib/schedule.js, lib/slideshow.js, lib/dynamicSet.js,
  lib/presets.js, presetsGroup.js, schema, metadata). GNOME 49–51, UUID `dynamic-wallpaper@eusebiuxii.com`.
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
    - track coloured by the sun's height; label lines (both modes) in the
      accent colour, poking out either side of the track; hour labels every 3 h; picture times outside the track;
      drag tag ("Dusk · 17:04", accent colour when snapped);
    - optional picture folder (thumbnail grid when adding), preview-date
      slider, "space evenly", fade length;
  - Wallpapers and Dynamic set tabs grey out whichever isn't in use
    (banner + "Use these instead" on Wallpapers);
  - **Theme tab**: optional light/dark style switch, off by default, with
    its own schedule: sunset → sunrise, dusk → dawn, or set times;
  - **Presets** (Dynamic set tab only, docs/5 "Presets"): save the set
    to a JSON file in `~/.local/share/dynamic-wallpaper/presets/`, switch
    between them from a dropdown above the clock, Save / Save as / Open
    file / Rename / Delete (to Trash) / Open folder / Show in Files; asks
    before replacing unsaved changes; picture paths stored as `~/...`;
    missing pictures shown as red rings and skipped by the extension;
  - Schedule tab's **Today** list: thumbnail, label, times and "Now" for
    each wallpaper, for whichever is in use;
  - keeps running on the lock screen (`unlock-dialog`);
  - re-checks on wake from sleep;
  - only changes the wallpaper/style when they need to change.
  - slideshow uses screen-sized copies of the pictures
    (`lib/scaledCopies.js`, in `~/.cache/dynamic-wallpaper/scaled`), made
    async; a 6K picture goes from ~145 MB decoded to ~15 MB. Wallpaper keys
    are written in one batch, so GNOME reloads it once (2026-11-10, not yet
    tested in a real session).
- Tests: `make test`, 56 passing. One older sun test ("New York,
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
- `make pack` builds a valid zip (includes dynamicSetPage.js, presetsGroup.js).
- Guides in `docs/` (1–5) and README.

## Where we left off (2026-11-07, late evening)

- Committed up to `2f3942d` (Theme tab, greying out). The user tried the
  real session: fades and the dynamic set work well; living with it for a
  while to be sure.
- **Not committed yet:** presets (`src/lib/presets.js`,
  `src/presetsGroup.js`, `tests/presets.test.js`, key `set-preset`), red
  rings for missing pictures, the extension skipping missing pictures, and
  these notes. Checked with tests, screenshots and a scripted run through
  open / edit / save / save as / rename / delete; not yet tried by hand in
  the real settings window.
- Open question: commit `726045b` (already pushed) has a personal email as
  author. Fixing it means rewriting that commit and force-pushing `main`;
  not done, waiting for a yes.

## Not done yet

- Presets by hand in the real settings window (needs `make schemas` and
  closing/reopening the window): the dropdown, dialogs, the ⋮ menu's
  Open Presets Folder / Show in Files.
- Theme tab switching at the right time (real session).
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
