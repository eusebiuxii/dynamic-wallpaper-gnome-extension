# 5. The dynamic set

The **Dynamic set** tab lets you use any number of pictures (8, 16, 24…)
spread around the day, instead of the simple day/night wallpapers. It's
meant to feel like the dynamic wallpapers on a Mac, without needing their
`.heic` files: you use plain images.

Added 2026-11-07. Still being tried out, so expect changes.

## Using it

1. Open the extension's settings and go to the **Dynamic set** tab.
2. Choose **Schedule by**: *Time of day* or *Sun* (see below).
3. Optionally choose a **Picture folder**. With a folder, adding a picture
   shows a grid of the pictures in it. Without one, the normal file picker
   opens. A grid can still open the file picker with **Browse…**.
4. **Click the track** where you want a picture to start, and pick the
   picture.
5. Turn on **Use the dynamic set**. While it's on, the Wallpapers tab is
   greyed out, with a banner saying its pictures aren't being used and a
   button to switch back. While it's off, this tab is greyed out instead
   (apart from the switch), so it's always clear which one is in use. Turn
   it on to set up pictures.

The light/dark style (its own Theme tab) and the location (Schedule tab)
work the same with either. The **Today** list at the bottom of the Schedule
tab shows the set's pictures for today, in order, with thumbnails, labels,
the times each shows and which one is showing now. With a sun-scheduled set,
the location stays visible there even if "At set times" is chosen; that
choice, and "Change the wallpaper", are greyed out while the set is in use,
since they only apply to the day/night wallpapers.

## The clock

```text
            12:00
     ╭───────●────────╮      noon at the top middle
     │                │
     ●   ┌────────┐   │
06:00│   │ picture│   ● 18:00
     │   └────────┘   │
     │   details      │
     ╰───────●────────╯
            00:00            midnight at the bottom middle
```

- The rounded square is a **24-hour clock**, running clockwise and evenly
  spaced: 6 hours per side, noon at the top, 18:00 on the right, midnight at
  the bottom, 06:00 on the left. Every 3 hours is labelled inside the track
  (the 03:00, 09:00, 15:00 and 21:00 ones sit in the corners).
- **Each picture's start time is written outside the track**, next to its
  dot (the selected one in bold, in the accent colour). When two would
  overlap, one moves further out; if there's no room at all it's left out,
  and hovering the dot still shows it.
- The track's **colour shows the sun** on the preview date at your location:
  pale yellow for day, an orange gradient from dawn to just after sunrise
  (and again around sunset), dark grey for night. It's worked out from how
  high the sun is (above 6°: day; 0° to 6°: orange to day; −6° to 0°: night
  to orange; below −6°: night).
- A small **triangle** outside the track marks the time now (only when the
  preview date is today).
- In Sun mode, short **ticks across the track** mark where each sun label
  falls that day: the places pictures snap to. They're dark on the light
  (day) part of the track and light on the dark (night) part, so they show
  everywhere, and they're ticks rather than dots so they don't look like
  pictures. Hover one to see its name and time. They grow while you drag.
- Each picture is a **coloured dot**. A grey dot is a picture whose sun
  label doesn't happen on the preview date (see "Far north" below).

What you can do:

| Do this | To |
| --- | --- |
| Click the track | add a picture starting there |
| Click a dot | show it in the middle, with its settings |
| Drag a dot | move it (see "Dragging" below) |
| Right-click a dot | remove it |
| Click inside the square, away from the track | deselect |
| Hover a dot | see its file name and time |

**The middle of the square** shows the selected picture: its thumbnail, file
name, when it starts, and *Change picture…* and *Remove* buttons. In time
mode, "when" is hour and minute pickers. In sun mode it's a label list plus
a minutes box ("Sunset +20 min"). Both step one minute at a time, for small
adjustments. With nothing selected it shows the picture showing now.

### Dragging

- **Time of day:** the dot moves in **15-minute steps**. For anything in
  between, use the hour and minute boxes in the middle.
- **Sun:** the dot **follows the pointer** anywhere on the track, and
  **snaps onto a sun label** when it comes within 8 minutes of one. Let go
  away from a label and the picture is kept as the nearest label plus or
  minus some minutes ("Sunset +20 min", "Midday −45 min"), so it still
  moves with the seasons.
- While dragging, a **tag** next to the dot says where it will land: "17:30"
  in time mode; "Dusk · 17:04" or "Sunset +14 min · 16:40" in sun mode. When
  it has snapped onto a label, the tag turns the accent colour and a ring
  appears around that label's mark.
- Dragging only saves when you let go.

**Under the clock:**

- **Preview date**: drag through the year to see the days get longer and
  shorter. In sun mode the dots move with it. This only changes the
  preview; the wallpaper always uses the real date.
- **Space the pictures evenly** (time mode only): keeps the pictures in
  order and spreads them evenly around the 24 hours, starting from the
  earliest.
- **Fade lasts**: how long each picture fades into the next. It's the same
  setting as on the Wallpapers tab.

## Time of day or Sun

**Time of day**: each picture starts at a clock time, the same every day.
Simple and predictable, but a "sunset" picture at 16:30 is right in
November and wrong in June.

**Sun**: each picture gets a label tied to the sun. The times are worked out
for every day at your location, so the pictures follow the seasons by
themselves:

17 labels: 12 for the daytime (dawn to dusk) and 5 for the night.

| | Label | When |
| --- | --- | --- |
| Day | Dawn | first light: civil dawn, the sun 6° below the horizon |
| | Sunrise | the sun comes up |
| | Early morning | ¼ of the way from sunrise to midday |
| | Morning | ½ way from sunrise to midday |
| | Late morning | ¾ of the way from sunrise to midday |
| | Midday | solar noon, the sun at its highest |
| | Early afternoon | ¼ of the way from midday to sunset |
| | Afternoon | ½ way from midday to sunset |
| | Late afternoon | ¾ of the way from midday to sunset |
| | Golden hour | the sun drops below 6° (in midwinter, when it barely gets that high: halfway from late afternoon to sunset) |
| | Sunset | the sun goes down |
| | Dusk | last light: civil dusk |
| Night | Evening | ⅓ of the way from dusk to midnight |
| | Night | ⅔ of the way from dusk to midnight |
| | Midnight | solar midnight, 12 hours after solar noon |
| | Late night | ⅓ of the way from midnight to the next dawn |
| | Before dawn | ⅔ of the way from midnight to the next dawn |

The in-between labels are fractions of the time between two sun events, so
they stretch and shrink with the seasons and always stay in order. Sets saved
before 17 labels used "Early day" and "Late day"; those load as Morning and
Afternoon.

- A picture can sit exactly on a label or a number of minutes before or
  after it (see "Dragging" above). Picking a label from the list puts the
  picture exactly on it (0 minutes).
- Each picture shows from its time until the next picture's, fading in at
  the start.
- **Several pictures can sit exactly on one label.** They're spread evenly
  from that label's time to the next label's, in the order they were added
  (pictures with a ± minutes offset are placed on their own). For
  example, four "Sunset" pictures play one after another between sunset and
  dusk.
- The label list only offers labels that happen at your location on the
  preview date.
- **Far north:** in summer there may be no dawn or dusk, and so none of
  the five night labels either (it never gets dark enough), and with midnight sun there's no sunrise or sunset
  either, only Midday and Midnight. A picture whose label doesn't happen
  that day is skipped, and its dot shows grey. In Manchester every label
  happens all year round.

**Switching** between the two keeps the pictures where they are today:
time → sun gives each picture the nearest label plus the minutes to it;
sun → time gives each the clock time it falls at today.

## How it works

Code:

- `src/lib/dynamicSet.js`: the scheduling, with no GNOME imports, so it's
  tested by `make test` (`tests/dynamicSet.test.js`). It works out label
  times (`labelTimes()`), where a clock time sits relative to the labels
  (`placeOnLabel()`, also used for snapping), when each picture starts on a
  given day (`entryTimes()`), and the list of changes (`setEvents()`), and turns those
  into a slideshow (`planSetSlideshow()`).
- `src/lib/schedule.js` and `src/lib/slideshow.js` were split so the same
  "list of changes → 24-hour cycle → slideshow file" code serves both the
  day/night wallpapers and the set (`cycleFromEvents()`,
  `phaseFromEvents()`, `planFromCycle()`).
- `src/lib/sun.js` gained `noon` in `getSunTimes()` and `getSunAltitude()`
  (for the track colours).
- `src/dynamicSetPage.js`: the tab. The clock is a `Gtk.DrawingArea` drawn
  with Cairo, with the details panel laid over its middle (`Gtk.Overlay`).
  Clicks and drags use `Gtk.GestureDrag`; the track is stored as one point
  per minute, and a click finds the nearest one.
- `src/extension.js`: when **Use the dynamic set** is on, it writes the set's
  slideshow instead of the day/night one. Everything else (new file name per
  change) is unchanged. The light/dark style follows its own schedule from
  the Theme tab, whichever wallpapers are in use.

The wallpaper is still a **GNOME slideshow file**, as explained in
[guide 2](2-how-this-extension-works.md). With 16 pictures it simply lists 16
pictures and 16 fades. GNOME only loads the two pictures it's fading between,
so many large images don't use much more memory.

Thumbnails: the folder grid uses the Files app's thumbnail cache when there
is one, and otherwise loads each image scaled down, one at a time while the
window is idle, so a folder of 6K images doesn't freeze the window.

Dragging only saves when you let go. Saving on every movement would make the
extension write a new slideshow file many times a second.

## Settings

| Key | Type | Meaning |
| --- | --- | --- |
| `use-set` | yes/no | use the dynamic set instead of the day/night wallpapers |
| `set-mode` | text | `time` or `sun` |
| `set-folder` | text | folder URI to pick pictures from, or empty |
| `set-images` | text (JSON) | the pictures (below) |

`set-images` is a list like:

```json
[
  {"uri": "file:///home/me/Pictures/sunrise.jpg", "time": 450, "label": "sunrise"},
  {"uri": "file:///home/me/Pictures/day.jpg", "time": 780, "label": "midday", "offset": 20}
]
```

`time` (minutes after midnight) is used in time mode; `label` and `offset`
(minutes after the label, negative for before, 0 if left out) in sun mode.
All are kept so switching modes doesn't lose anything.

Seeing it from the terminal:

```bash
gsettings get org.gnome.shell.extensions.dynamic-wallpaper set-images
gsettings set org.gnome.shell.extensions.dynamic-wallpaper use-set true
```

Previewing the tab without installing:

```bash
GSETTINGS_BACKEND=memory GI_TYPELIB_PATH=/usr/lib64/gnome-shell/girepository-1.0 \
LD_LIBRARY_PATH=/usr/lib64/gnome-shell \
  gjs -m tests/prefs-window.js --page dynamic-set --select 0 \
  --set "set-images='[{\"uri\":\"file:///path/to/a.jpg\",\"time\":480,\"label\":\"sunrise\"}]'"
```

## Not done yet / ideas

- **Placing pictures automatically** from a folder: from times or words in
  the file names ("sunrise", "night", "0730"), or from how bright and warm
  each picture is. Every picture is placed by hand for now.
- **Importing Apple `.heic` dynamic wallpapers**: unpack the pictures and
  their sun positions into a folder plus a set. Later.
- Reordering pictures that share a label (for now it's the order they were
  added).
- Writing the slideshow less often: with many pictures the extension
  writes a new file at every picture change. That's harmless, but once a day
  would do.
