# 1. What a GNOME extension is

GNOME Shell (the top bar, overview, dock, lock screen…) is mostly written in
**JavaScript**. An extension is more JavaScript that GNOME Shell loads into
itself, so it can change almost anything about the desktop.

The JavaScript runs on **GJS** (GNOME JavaScript): a JavaScript engine (the
same one Firefox uses) plus access to GNOME's libraries, such as GLib, Gio,
GTK and GNOME Shell's own. If you know modern JavaScript, the language is the
same: `class`, `import`, arrow functions, `async`. What's different is the
libraries you call.

## The files

An extension is just a folder named after its **UUID** (its unique ID):

```text
dynamic-wallpaper@eusebiuxii.com/
  metadata.json
  extension.js
  prefs.js          (optional: the settings window)
  schemas/          (optional: settings storage)
  stylesheet.css    (optional: styling for things you add to the shell)
```

GNOME looks for extensions in two places:

- `~/.local/share/gnome-shell/extensions/`: yours, installed per user.
- `/usr/share/gnome-shell/extensions/`: installed by the system, e.g. with
  `dnf`.

### metadata.json

Describes the extension:

```json
{
  "uuid": "dynamic-wallpaper@eusebiuxii.com",
  "name": "Dynamic Wallpaper",
  "description": "…",
  "shell-version": ["49", "50", "51"],
  "settings-schema": "org.gnome.shell.extensions.dynamic-wallpaper"
}
```

- **uuid**: unique ID, in the form `name@domain`. Use a domain you own (or
  your GitHub username) so it can't clash with anyone else's. It must match
  the folder name.
- **shell-version**: the GNOME versions it works on. GNOME refuses to load
  it on any other version, unless you turned that check off as in the
  Fedora guide. Only list versions you've tested.
- **session-modes** (optional): by default extensions only run while you're
  logged in and unlocked. This one adds `unlock-dialog` to keep running on
  the lock screen.

### extension.js

The code that runs **inside GNOME Shell**. It exports a class with two
methods:

```js
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

export default class MyExtension extends Extension {
    enable() {
        // Switched on, or you just logged in: set everything up.
    }

    disable() {
        // Switched off, logging out, or the screen locked: undo
        // EVERYTHING enable() did.
    }
}
```

The golden rule: **`disable()` must undo everything `enable()` did.**
Disconnect every signal, remove every timer, destroy everything you added to
the screen. Extensions get enabled and disabled many times in one session
(every screen lock, for most), so anything left behind piles up. That's what
the leftover Dash to Dock objects in the Fedora guide's performance section
were.

Because the code runs inside GNOME Shell, a bad error can break the
desktop, and on Wayland a crash logs you out. Test carefully (see guide 3).

### prefs.js

The settings window, opened from the Extensions app or Extension Manager. It
runs in a **separate process** from GNOME Shell, so it's a normal
**GTK 4 / libadwaita** app:

```js
import Adw from 'gi://Adw';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class MyPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const page = new Adw.PreferencesPage();
        // …add groups and rows…
        window.add(page);
    }
}
```

Because they're separate processes, the two halves have different rules:

| | extension.js | prefs.js |
| --- | --- | --- |
| Runs in | GNOME Shell | its own window/process |
| UI toolkit | St and Clutter (GNOME Shell's) | GTK 4 and libadwaita |
| Can't import | Gtk, Adw, Gdk | St, Clutter, Meta, Shell |

They talk to each other through **settings**.

### Settings (GSettings) and schemas

Settings are stored by **GSettings** (the same system all of GNOME uses; you
can browse it with `dconf-editor`). Before you can store a setting, you
declare it in a **schema**, an XML file listing each key, its type and its
default:

```xml
<key name="use-transitions" type="b">
  <default>false</default>
  <summary>Show sunrise and sunset wallpapers</summary>
</key>
```

Types are single letters: `b` boolean, `i` whole number, `d` decimal,
`s` text, `as` list of text.

Both halves call `this.getSettings()` to read and write them. The settings
window writes a value, the extension is told it changed (the `changed`
signal), and reacts. That's the whole connection between the two.

Schemas have to be **compiled** before GNOME can read them
(`glib-compile-schemas`). GNOME does that for you when installing from a
zip. When developing from a linked folder, you do it yourself
(`make schemas`).

## Importing things

Three kinds of `import`:

```js
// GNOME libraries, through GObject Introspection ("gi")
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=4.0';

// GNOME Shell's own JavaScript, built into GNOME Shell
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// Your own files, by relative path
import {getSunTimes} from './lib/sun.js';
```

GNOME 45 changed extensions to this `import` style ("ES modules"). Older
guides and extensions use `imports.gi.Gio` and `ExtensionUtils` instead. That
code doesn't work on GNOME 45+, so check the date on anything you read.

## Signals

GNOME libraries announce events through **signals**. You `connect` a
function and get back an ID, which you use later to `disconnect`:

```js
const id = settings.connect('changed::use-transitions', () => { … });
// …later, in disable():
settings.disconnect(id);
```

Most of "undo everything in `disable()`" is disconnecting signals and
removing timers (`GLib.source_remove(id)`).

## Where to read more

- **gjs.guide**: the official guide to GJS and extensions.
  - <https://gjs.guide/extensions/>: start with "Getting Started".
  - <https://gjs.guide/extensions/review-guidelines/review-guidelines.html>:
    the rules for publishing.
- **GNOME API docs** (GLib, Gio, GTK, Adw): <https://gjs-docs.gnome.org/>
- **GNOME Shell's own code**, to see how built-in features work:
  <https://gitlab.gnome.org/GNOME/gnome-shell/-/tree/main/js>
- **Other extensions' code**: every extension on extensions.gnome.org links
  to its source. Reading a small one is the fastest way to learn.
