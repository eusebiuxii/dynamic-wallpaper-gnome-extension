# 2. How this extension works

The extension has five parts. The three in `lib/` are plain JavaScript with
no GNOME imports, so they can be tested on their own.

```text
               settings (GSettings)
          ┌──────────────┴──────────────┐
          │ writes                reads │ and watches for changes
     prefs.js                     extension.js
   (settings window)            (inside GNOME Shell)
          │                             │
          └───────── both use ──────────┘   also uses lib/slideshow.js
                lib/schedule.js  →  lib/sun.js
```

## lib/sun.js: sunrise, sunset, dawn and dusk

`getSunTimes(date, latitude, longitude)` returns that day's dawn, sunrise,
sunset and dusk as `Date` objects. Dawn and dusk are civil twilight: the sun
6° below the horizon, roughly when it's light enough to see outside. It uses
the standard "sunrise equation", accurate to a minute or two. Near the poles
the sun may not rise or set at all; then it returns `polar: 'day'` or
`polar: 'night'` instead. In summer far north the sun sets but the sky never
gets that dark; then dawn and dusk are `null`.

## lib/schedule.js: which wallpaper, and until when

The day is split into four **phases**: night, sunrise, day, sunset.

`getPhase(now, config)` answers two questions:

- **Which phase is it now?** That decides the wallpaper.
- **When does the phase next change?** That decides when to check again.

How it works:

1. For each day from two days ago to two days ahead, it works out when light
   starts and dark starts: dawn, sunrise, sunset and dusk in sun mode, or
   your two times in set-times mode.
2. It turns those into a list of changes, e.g. "06:26 sunrise → 07:26 day →
   16:01 sunset → 17:01 night" (London in November: dawn 06:26, dusk 17:01,
   with 60 minutes).
3. The current phase is the last change before now, and the next change is
   the first one after now.

Looking at several days, not just today, makes the awkward cases work
without special code: just after midnight (still last night's phase), nights
that start after midnight, and time zones far from Greenwich.

With sunrise and sunset wallpapers on:

- the **sunrise** wallpaper shows for the chosen time, starting at **dawn**;
- the **sunset** wallpaper shows for the chosen time, ending at **dusk**;
- where there's no dawn or dusk (set times, or far north in summer when it
  never gets dark), sunrise and sunset are used instead: "Day starts" and
  "Night starts" in set-times mode;
- if the day is too short for both, they split it half each.

Without sunrise and sunset wallpapers, day and night switch at sunrise and
sunset.

The light/dark style has its own schedule (Theme tab), worked out with the
same `getPhase()`: the style is dark during its night phase. "Sunset to
sunrise" is a sun config without transitions, "dusk to dawn" one with them,
and "set times" a fixed config with its own two times.

`wallpaperForPhase()` picks the image. A missing sunrise or sunset image
falls back to the day one.

`getCycle(now, config)` lists the phases for the next 24 hours, starting at
the most recent change. The slideshow below is built from it. It stops when
the first phase comes round again, because in autumn tomorrow's sunset is a
few minutes earlier than today's.

## lib/slideshow.js: a wallpaper GNOME times by itself

GNOME Shell draws the wallpaper at login **before** it starts any
extensions. If the extension set a plain image, you'd see whatever was set
when you last shut down (say, night) for a moment, then a swap to the right
one.

So instead the extension writes a **slideshow file**, the same XML format
GNOME's own day/night wallpapers use, and points the wallpaper at it. The
file lists each picture, how long it shows and how long the fade into it
lasts, starting from a set date and time, and GNOME repeats it once the list
runs out. GNOME works out the right picture from the clock as soon as it
loads the file, so it's right from the first frame. GNOME also does the
fades, and re-checks after sleep and time zone changes.

- `planSlideshow()` turns the 24-hour cycle into pieces: neighbours showing
  the same picture are merged, and each piece starts with a fade from the
  one before (the first fades in from the last, as the cycle repeats).
  Fades start **at** each change: at dawn, the night wallpaper starts fading
  into the sunrise one. A fade is never longer than the piece it fades into.
- `slideshowXml()` writes that as XML.

Because the file starts at the latest change and the extension writes a new
one at every change, it never drifts by more than a minute or two even
though sunrise moves through the year. If the computer is off for days, the
old file is only out by that drift until the extension starts and replaces
it.

## lib/dynamicSet.js: many pictures

The Dynamic set tab's pictures are scheduled here, by clock time or by sun
labels (dawn, sunrise, midday…). It makes the same kind of change list as
schedule.js and reuses the same cycle and slideshow code
(`cycleFromEvents()`, `planFromCycle()`). The whole feature is described in
[guide 5](5-dynamic-set.md).

## extension.js: doing it

When enabled, the extension:

1. **Applies the current phase:** writes a new slideshow file to
   `~/.local/share/dynamic-wallpaper/` and points GNOME's wallpaper at it
   (both the light- and dark-style keys, so it shows whatever style you're
   in). If you turned it on, it also sets the light/dark style, on its own
   schedule. Wallpaper and style are tracked separately, so each only
   changes when it needs to.
2. **Sets a timer** for the next change. The timer is capped at 5 minutes, so
   it still corrects itself if the clock or time zone changes.
3. **Watches its settings**, and re-applies straight away when you change
   anything in the settings window.
4. **Listens for the laptop waking from sleep** (the `PrepareForSleep` signal
   from systemd-logind), because timers are frozen while suspended.

It only sets the wallpaper when the phase **changes**. If you pick a
different wallpaper in GNOME Settings by hand, it stays until the next
sunrise or sunset.

Each slideshow file gets a **new name** (`schedule-<time>.xml`): GNOME
remembers a slideshow by its file name and never re-reads it, so rewriting
the same file wouldn't do anything. Switching from one file to the next
isn't visible, because both show the same picture at that moment. The
extension keeps the current file and the one before, and deletes older ones.
If nothing changed (for example when you log in again on the same day), it
keeps the file it has.

`disable()` removes the timer and disconnects both signals. It leaves the
wallpaper as it is.

## prefs.js: the settings window

Four pages, in this order: Wallpapers, Dynamic set, Theme, Schedule. They're
mostly built from libadwaita rows (the Dynamic set page, in
`dynamicSetPage.js`, is described in [guide 5](5-dynamic-set.md)):

- **Wallpapers:** a row per image, each with a thumbnail and choose/remove
  buttons, the sunrise/sunset switch, and how long fades last. Greyed out
  (with a banner and a "Use these instead" button) while the dynamic set is
  in use. The Dynamic set page is greyed out the other way round, apart
  from its on/off switch, so it's always clear which one is in use.
  `fadeWhenOff()` also fades greyed-out pictures and the clock, which GTK
  doesn't dim by itself.
- **Schedule:** sun mode or set times. Sun mode shows the location (city
  search plus coordinates). Set-times mode shows hour and minute pickers. At
  the bottom, a **Today** preview lists every wallpaper that shows today:
  thumbnail, which one it is, the times it shows (e.g. 16:04 – 17:04), and
  a **Now** tag on the one showing. It follows whichever is in use: up to 4
  rows for the day/night wallpapers, or one row per picture (by label, or by
  file name in time mode) for the dynamic set. It uses the same `lib/` code
  as the extension, so it always matches what will happen, and updates every
  minute while the window is open. "Change the wallpaper" and the set times
  are greyed out while the dynamic set is in use, since they only apply to
  the day/night wallpapers.
- **Theme:** light/dark style switching, off by default. When it's dark: sunset to
  sunrise, dusk to dawn, or set times (its own, separate from the
  wallpapers'). A small Today preview shows when light and dark start.

The city search uses **libgweather**, the offline list of places behind
GNOME Weather and Clocks, so no internet or API key is needed. The list is
loaded the first time you search.

Simple settings are linked to their rows with `settings.bind()`, which keeps
the row and the setting in sync both ways with one line. The rest are
connected by hand. Every listener goes through `this._watch()`, so they can
all be disconnected when the window closes.

## The settings (schemas/…gschema.xml)

| Key | Type | Meaning |
| --- | --- | --- |
| `mode` | text | `sun` or `fixed` |
| `latitude`, `longitude` | decimal | location, in degrees |
| `location-name` | text | shown in the settings only |
| `day-start`, `night-start` | number | set times, in minutes after midnight |
| `wallpaper-day`, `-night`, `-sunrise`, `-sunset` | text | image file URIs |
| `use-transitions` | yes/no | show sunrise and sunset wallpapers |
| `transition-minutes` | number | how long each one shows |
| `fade-minutes` | number | how long each change fades, 0 = swap straight away |
| `switch-style` | yes/no | switch light/dark style (Theme tab) |
| `style-mode` | text | `sun` (sunset → sunrise), `twilight` (dusk → dawn) or `fixed` |
| `style-day-start`, `style-night-start` | number | the style's set times, in minutes after midnight |
| `use-set`, `set-mode`, `set-folder`, `set-images` | | the dynamic set, see [guide 5](5-dynamic-set.md) |

You can read and change them from the terminal too, which is handy for
testing:

```bash
gsettings --schemadir src/schemas list-recursively org.gnome.shell.extensions.dynamic-wallpaper
gsettings --schemadir src/schemas set org.gnome.shell.extensions.dynamic-wallpaper mode fixed
```

## Ideas for later

- A "Use my current location" button (GNOME's location service, Geoclue).
- Picking one of the light/dark wallpaper pairs from GNOME Settings as the
  day/night images.
- Translations.
