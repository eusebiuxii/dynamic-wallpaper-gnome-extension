# 4. Building and releasing

## The whole journey

```text
idea → code (src/) → test (guide 3) → pack a zip → upload to
extensions.gnome.org → review → published → users install it
                                   ↑
         fix, bump the version, pack, upload again ← new GNOME version / bug
```

## Building: `make pack`

```bash
make pack
```

This runs the tests, then `gnome-extensions pack`, which zips `src/` into
`dist/dynamic-wallpaper@eusebiuxii.com.shell-extension.zip`. That zip is the
finished extension: what you upload, and what users install.

`gnome-extensions pack` includes `extension.js`, `prefs.js`,
`metadata.json`, `stylesheet.css` and the schema XML automatically. Anything
else needs `--extra-source`, which is why the Makefile passes
`--extra-source=lib`. If you add a new file or folder, add it there too,
otherwise the zip installs but fails with "module not found".

Check what's inside with:

```bash
unzip -l dist/*.zip
```

There's no compile step: GNOME runs the JavaScript as it is. The only thing
compiled is the schema, and GNOME does that itself when installing the zip.

## Versions

There are two version numbers:

- **`version`**: a whole number that extensions.gnome.org sets itself,
  going up by one with every upload you make. Don't put it in
  `metadata.json` yourself.
- **`version-name`**: what people see, e.g. `"0.1.0"`. You choose it.
  Change it for each release.

And `shell-version`, the GNOME versions it supports. When a new GNOME comes
out (every March and September), test it there (Fedora ships it about a
month later), add the version, and release an update.

## Before releasing

1. `make test` passes.
2. Test the real thing: `make install`, log out and in, use it for a day
   (or use set times, as in guide 3).
3. Check the log for errors: `make logs`.
4. Turn it off and on a few times in the Extensions app, and lock and unlock
   the screen. Nothing should go wrong, and `make logs` should stay quiet.
5. Bump `version-name` in `src/metadata.json`.
6. `make pack`.

## Publishing on extensions.gnome.org

Extensions.gnome.org (EGO) is the official store, where Extension Manager
and the browser add-on install from.

1. Make an account at <https://extensions.gnome.org/accounts/register/>.
2. Go to <https://extensions.gnome.org/upload/> and upload the zip.
3. It goes into a **review queue**. Volunteers read the code against the
   review guidelines. That usually takes from a few days to a couple of
   weeks.
4. If something needs changing, the reviewer leaves a comment. Fix it, bump
   `version-name`, and upload again.
5. Once accepted, it's live. Updates go through review too, but are usually
   quicker.

### What reviewers check

The full list is at
<https://gjs.guide/extensions/review-guidelines/review-guidelines.html>.
The main points, and how this extension handles them:

| Rule | Here |
| --- | --- |
| Don't create anything until `enable()` (no work at import time or in the constructor) | Everything is set up in `enable()` |
| `disable()` undoes everything | Timer removed, both signals disconnected, references cleared |
| Code must be readable: no minified or obfuscated code | Plain source |
| Only include files that are needed | The zip has 8 files |
| `unlock-dialog` must be justified in a comment in `disable()` | The comment explains it keeps the wallpaper schedule running |
| Don't use deprecated modules (`imports.*`, `ExtensionUtils`) on GNOME 45+ | ES modules only |
| Don't log excessively | It logs nothing during normal use |
| No GTK in extension.js, no Shell libraries in prefs.js | Kept separate |
| Licence must be GPL-compatible | GPL-2.0-or-later (LICENSE file, plus a header in each source file) |

## Source code on GitHub

Not required, but expected: the EGO page links to it, and people report bugs
there.

```bash
git add .
git commit -m "First version"
gh repo create dynamic-wallpaper-gnome-extension --public --source . --push
```

Then `metadata.json`'s `"url"` points to it (already set to
`https://github.com/eusebiuxii/dynamic-wallpaper-gnome-extension`; change it if you use a
different name).

For each release, tag it and attach the zip, so people can install without
EGO:

```bash
git tag v0.1.0
git push --tags
gh release create v0.1.0 dist/*.zip --title "0.1.0" --notes "First release"
```

## Installing a zip by hand (for testers)

Anyone can install a zip without EGO:

```bash
gnome-extensions install --force dynamic-wallpaper@eusebiuxii.com.shell-extension.zip
```

Then log out and back in, and enable it in the Extensions app.

## Keeping it working

- **New GNOME release:** test, add it to `shell-version`, release. Check
  the "Port extensions to GNOME XX" page on gjs.guide for anything that
  changed.
- **Bug reports:** reproduce with `make nested`, fix, add a test if it's in
  `lib/`, release.
