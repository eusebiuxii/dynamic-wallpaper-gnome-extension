// SPDX-License-Identifier: GPL-2.0-or-later
// The part that runs inside GNOME Shell.
//
// GNOME calls enable() when the extension is switched on (and at login) and
// disable() when it's switched off or you log out. Most extensions are also
// disabled while the screen is locked; this one asks to keep running there
// ("session-modes" in metadata.json), because the lock screen shows the
// wallpaper too and the change should still happen on time.
//
// Everything enable() sets up, disable() must undo.
//
// The wallpaper itself is a GNOME slideshow file (see lib/slideshow.js) that
// this extension writes and keeps up to date. GNOME picks the right picture
// from it by the clock, even at login before this extension has started.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {getPhase, phaseFromEvents, Phase} from './lib/schedule.js';
import {planSlideshow, slideshowXml} from './lib/slideshow.js';
import {parseEntries, planSetSlideshow, setEvents} from './lib/dynamicSet.js';
import {removeUnusedCopies, scaledCopy, screenSize} from './lib/scaledCopies.js';

// However far away the next change is, check again at least this often.
// It catches the clock changing, time zone changes and anything else the
// timer can't know about.
const MAX_WAIT_SECONDS = 5 * 60;

// Slideshow files are named like this, in ~/.local/share/dynamic-wallpaper.
// Each update gets a new name: GNOME remembers a slideshow by its file name
// and wouldn't notice the same file being rewritten.
const FILE_PREFIX = 'schedule-';
const FILE_SUFFIX = '.xml';

export default class DynamicWallpaperExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._background = new Gio.Settings({schema_id: 'org.gnome.desktop.background'});
        this._interface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._dir = GLib.build_filenamev([GLib.get_user_data_dir(), 'dynamic-wallpaper']);
        this._cacheDir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'dynamic-wallpaper', 'scaled']);
        this._cancellable = new Gio.Cancellable();

        this._timeoutId = 0;
        this._writeSerial = 0;
        this._lastPhase = null;
        this._lastDark = null;

        // Any change in our settings: re-apply straight away.
        this._settingsChangedId = this._settings.connect('changed', () => {
            this._lastPhase = null;
            this._lastDark = null;
            this._update();
        });

        // Waking from sleep: the timer was frozen while suspended, so check
        // now instead of waiting for it.
        this._sleepSignalId = Gio.DBus.system.signal_subscribe(
            'org.freedesktop.login1', 'org.freedesktop.login1.Manager',
            'PrepareForSleep', '/org/freedesktop/login1', null,
            Gio.DBusSignalFlags.NONE,
            (_conn, _sender, _path, _iface, _signal, params) => {
                const [goingToSleep] = params.deepUnpack();
                if (!goingToSleep)
                    this._update();
            });

        // A different screen size needs different-sized copies of the
        // pictures (see lib/scaledCopies.js).
        this._monitorsChangedId = Main.layoutManager.connect('monitors-changed', () => {
            this._lastPhase = null;
            this._update();
        });

        this._update();
    }

    // This extension uses the 'unlock-dialog' session mode: it keeps running
    // while the screen is locked, because the lock screen shows the desktop
    // wallpaper and a sunrise or sunset change should still happen on time.
    // It adds nothing to the lock screen itself.
    disable() {
        // Stop any slideshow still being prepared.
        this._writeSerial++;
        this._cancellable.cancel();
        this._cancellable = null;

        if (this._monitorsChangedId) {
            Main.layoutManager.disconnect(this._monitorsChangedId);
            this._monitorsChangedId = 0;
        }
        if (this._timeoutId) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
        if (this._sleepSignalId) {
            Gio.DBus.system.signal_unsubscribe(this._sleepSignalId);
            this._sleepSignalId = 0;
        }
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }

        // The wallpaper is left as it is, so turning the extension off
        // doesn't suddenly change what's on screen.
        this._settings = null;
        this._background = null;
        this._interface = null;
        this._dir = null;
        this._cacheDir = null;
        this._lastPhase = null;
        this._lastDark = null;
    }

    _readConfig() {
        const s = this._settings;
        return {
            mode: s.get_string('mode'),
            latitude: s.get_double('latitude'),
            longitude: s.get_double('longitude'),
            dayStart: s.get_int('day-start'),
            nightStart: s.get_int('night-start'),
            transitions: s.get_boolean('use-transitions'),
            transitionMinutes: s.get_int('transition-minutes'),
        };
    }

    /** The chosen pictures as file paths ('' when not set). */
    _readWallpapers() {
        const s = this._settings;
        const path = key => {
            const uri = s.get_string(key);
            return uri ? Gio.File.new_for_uri(uri).get_path() ?? '' : '';
        };
        const useTransitions = s.get_boolean('use-transitions');
        return {
            day: path('wallpaper-day'),
            night: path('wallpaper-night'),
            sunrise: useTransitions ? path('wallpaper-sunrise') : '',
            sunset: useTransitions ? path('wallpaper-sunset') : '',
        };
    }

    /**
     * The dynamic set (see lib/dynamicSet.js), or null when it's not in use.
     * Entries get a `file` path for the slideshow.
     */
    _readSet() {
        const s = this._settings;
        if (!s.get_boolean('use-set'))
            return null;
        const entries = parseEntries(s.get_string('set-images'))
            .map(entry => ({...entry, file: Gio.File.new_for_uri(entry.uri).get_path() ?? ''}))
            // A missing picture (deleted, or on a drive that isn't
            // plugged in) is left out rather than showing a blank screen.
            .filter(entry => entry.file && GLib.file_test(entry.file, GLib.FileTest.EXISTS));
        return {
            mode: s.get_string('set-mode'),
            latitude: s.get_double('latitude'),
            longitude: s.get_double('longitude'),
            entries,
        };
    }

    /**
     * When the light/dark style switches, as a schedule.js config: the style
     * is dark during its night phase. It has its own setting, separate from
     * the wallpapers (Theme tab), but uses the same location.
     */
    _readStyleConfig() {
        const s = this._settings;
        const styleMode = s.get_string('style-mode');
        return {
            mode: styleMode === 'fixed' ? 'fixed' : 'sun',
            latitude: s.get_double('latitude'),
            longitude: s.get_double('longitude'),
            dayStart: s.get_int('style-day-start'),
            nightStart: s.get_int('style-night-start'),
            // With "transitions", night runs from dusk to dawn.
            transitions: styleMode === 'twilight',
            transitionMinutes: 60,
        };
    }

    /** Apply whatever changed (wallpaper and/or style) and set the next timer. */
    _update() {
        const now = new Date();
        let next = null;
        const sooner = time => {
            if (time && (!next || time < next))
                next = time;
        };

        // Which picture should show: from the dynamic set if it's in use,
        // otherwise the day/night phase.
        let wallpaperKey;
        const set = this._readSet();
        if (set) {
            const picture = phaseFromEvents(now, setEvents(now, set));
            wallpaperKey = `set ${picture.phase}`;
            sooner(picture.nextChange);
        } else {
            const {phase, nextChange} = getPhase(now, this._readConfig());
            wallpaperKey = phase;
            sooner(nextChange);
        }

        // Light or dark style, if that's switched on.
        let dark = null;
        if (this._settings.get_boolean('switch-style')) {
            const {phase, nextChange} = getPhase(now, this._readStyleConfig());
            dark = phase === Phase.NIGHT;
            sooner(nextChange);
        }

        // Only touch things when they actually change. That way if you pick
        // a different wallpaper or style by hand, it stays until the next
        // change.
        if (wallpaperKey !== this._lastPhase) {
            this._writeSlideshow(now).catch(e => {
                if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    console.error(`Dynamic Wallpaper: couldn't update the wallpaper: ${e.message}`);
            });
            this._lastPhase = wallpaperKey;
        }
        if (dark !== null && dark !== this._lastDark)
            this._setIfDifferent(this._interface, 'color-scheme', dark ? 'prefer-dark' : 'default');
        this._lastDark = dark;

        this._scheduleNext(now, next);
    }

    /**
     * Writes the next 24 hours as a slideshow and points the wallpaper at it.
     * Writing it again at every change keeps it in step with the sun, which
     * rises a minute or two earlier or later each day.
     *
     * The slideshow uses screen-sized copies of the pictures, made first if
     * they aren't there yet. That takes a moment, so it's async; if another
     * update or disable() comes along meanwhile, this one gives up.
     */
    async _writeSlideshow(now) {
        const serial = ++this._writeSerial;
        const fadeSeconds = this._settings.get_int('fade-minutes') * 60;
        const set = this._readSet();
        const plan = set
            ? planSetSlideshow(now, set, fadeSeconds)
            : planSlideshow(now, this._readConfig(), this._readWallpapers(), fadeSeconds);
        if (!plan)
            return; // no pictures chosen yet: leave the wallpaper alone

        // One at a time, so a new set of pictures doesn't start a dozen
        // decoders at once.
        const screen = screenSize();
        const copies = new Map();
        for (const slide of plan.slides) {
            if (!copies.has(slide.file)) {
                copies.set(slide.file,
                    await scaledCopy(slide.file, screen, this._cacheDir, this._cancellable));
                if (serial !== this._writeSerial)
                    return;
            }
        }
        plan.slides = plan.slides.map(slide => ({...slide, file: copies.get(slide.file)}));

        const xml = slideshowXml(plan);
        const current = this._ourFile(this._background.get_string('picture-uri'));
        const currentXml = current ? this._readFile(current) : null;
        if (currentXml === xml) {
            this._setIfDifferent(this._background, 'picture-uri-dark',
                this._background.get_string('picture-uri'));
            return;
        }

        GLib.mkdir_with_parents(this._dir, 0o755);
        const name = `${FILE_PREFIX}${Date.now()}${FILE_SUFFIX}`;
        const path = GLib.build_filenamev([this._dir, name]);
        GLib.file_set_contents(path, xml);

        // GNOME has separate wallpapers for light and dark style; set both
        // so it shows whichever style is active.
        // Both keys in one go: GNOME and every extension drawing the
        // wallpaper reload it on each change, so this makes it one reload.
        const uri = Gio.File.new_for_path(path).get_uri();
        // (A separate object: delay() can't be switched off again.)
        const batch = new Gio.Settings({schema_id: 'org.gnome.desktop.background'});
        batch.delay();
        this._setIfDifferent(batch, 'picture-uri', uri);
        this._setIfDifferent(batch, 'picture-uri-dark', uri);
        batch.apply();

        // Tidy up older files. The one just replaced stays until next time,
        // as GNOME may still be fading away from it (and so do its copies).
        this._removeOldFiles([name, current && GLib.path_get_basename(current)]);
        removeUnusedCopies(this._cacheDir, copy =>
            xml.includes(copy) || (currentXml?.includes(copy) ?? false));
    }

    /** The path if `uri` is one of our slideshow files, otherwise null. */
    _ourFile(uri) {
        if (!uri)
            return null;
        const path = Gio.File.new_for_uri(uri).get_path();
        if (!path || GLib.path_get_dirname(path) !== this._dir)
            return null;
        const name = GLib.path_get_basename(path);
        return name.startsWith(FILE_PREFIX) && name.endsWith(FILE_SUFFIX) ? path : null;
    }

    _readFile(path) {
        try {
            const [, bytes] = GLib.file_get_contents(path);
            return new TextDecoder().decode(bytes);
        } catch {
            return null;
        }
    }

    _removeOldFiles(keep) {
        const dir = Gio.File.new_for_path(this._dir);
        const children = dir.enumerate_children('standard::name',
            Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = children.next_file(null))) {
            const name = info.get_name();
            if (name.startsWith(FILE_PREFIX) && name.endsWith(FILE_SUFFIX) &&
                !keep.includes(name))
                dir.get_child(name).delete(null);
        }
        children.close(null);
    }

    _setIfDifferent(settings, key, value) {
        if (settings.get_string(key) !== value)
            settings.set_string(key, value);
    }

    _scheduleNext(now, nextChange) {
        if (this._timeoutId)
            GLib.source_remove(this._timeoutId);

        let seconds = MAX_WAIT_SECONDS;
        if (nextChange) {
            // +1 so we wake just after the change, not just before it.
            const untilChange = Math.ceil((nextChange - now) / 1000) + 1;
            seconds = Math.max(1, Math.min(untilChange, MAX_WAIT_SECONDS));
        }

        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
            this._timeoutId = 0;
            this._update();
            return GLib.SOURCE_REMOVE;
        });
    }
}
