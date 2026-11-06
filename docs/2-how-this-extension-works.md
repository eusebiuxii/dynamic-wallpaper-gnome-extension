# 2. How this extension works

The extension has four parts. The two in `lib/` are plain JavaScript with no
GNOME imports, so they can be tested on their own.

```text
               settings (GSettings)
          ┌──────────────┴──────────────┐
          │ writes                reads │ and watches for changes
     prefs.js                     extension.js
   (settings window)            (inside GNOME Shell)
          │                             │
          └───────── both use ──────────┘
                lib/schedule.js  →  lib/sun.js
```

## lib/sun.js: sunrise and sunset

`getSunTimes(date, latitude, longitude)` returns that day's sunrise and
sunset as `Date` objects. It uses the standard "sunrise equation", accurate
to a minute or two. Near the poles the sun may not rise or set at all; then
it returns `polar: 'day'` or `polar: 'night'` instead.

## lib/schedule.js: which wallpaper, and until when

The day is split into four **phases**: night, sunrise, day, sunset.

`getPhase(now, config)` answers two questions:

- **Which phase is it now?** That decides the wallpaper.
- **When does the phase next change?** That decides when to check again.

How it works:

1. For each day from two days ago to two days ahead, it works out when light
   starts and dark starts: sunrise and sunset in sun mode, or your two times
   in set-times mode.
2. It turns those into a list of changes, e.g. "07:02 sunrise → 08:02 day →
   15:32 sunset → 16:32 night".
3. The current phase is the last change before now, and the next change is
   the first one after now.

Looking at several days, not just today, makes the awkward cases work
without special code: just after midnight (still last night's phase), nights
that start after midnight, and time zones far from Greenwich.

With sunrise and sunset wallpapers on:

- the **sunrise** wallpaper shows from sunrise, for the chosen time;
- the **sunset** wallpaper shows in the time **before** sunset, while it's
  still light;
- if the day is too short for both, they split it half each.

`wallpaperForPhase()` picks the image. A missing sunrise or sunset image
falls back to the day one.

## extension.js: doing it

When enabled, the extension:

1. **Applies the current phase:** sets GNOME's wallpaper (both the light-
   and dark-style keys, so it shows whatever style you're in) and, if
   you turned it on, the light/dark style.
2. **Sets a timer** for the next change. The timer is capped at 5 minutes, so
   it still corrects itself if the clock or time zone changes.
3. **Watches its settings**, and re-applies straight away when you change
   anything in the settings window.
4. **Listens for the laptop waking from sleep** (the `PrepareForSleep` signal
   from systemd-logind), because timers are frozen while suspended.

It only sets the wallpaper when the phase **changes**. If you pick a
different wallpaper in GNOME Settings by hand, it stays until the next
sunrise or sunset.

`disable()` removes the timer and disconnects both signals. It leaves the
wallpaper as it is.

## prefs.js: the settings window

Two pages, built from libadwaita rows:

- **Wallpapers:** a row per image, each with a thumbnail and choose/remove
  buttons, the sunrise/sunset switch, and the style switch.
- **Schedule:** sun mode or set times. Sun mode shows the location (city
  search plus coordinates). Set-times mode shows hour and minute pickers. At
  the bottom, a **Today** preview shows when each wallpaper starts, using
  the same `lib/schedule.js` as the extension, so it always matches what will
  happen.

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
| `switch-style` | yes/no | also switch light/dark style |

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
- A smooth cross-fade between wallpapers.
- Translations.
