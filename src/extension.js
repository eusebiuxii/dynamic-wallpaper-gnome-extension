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

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {getPhase, wallpaperForPhase, Phase} from './lib/schedule.js';

// However far away the next change is, check again at least this often.
// It catches the clock changing, time zone changes and anything else the
// timer can't know about.
const MAX_WAIT_SECONDS = 5 * 60;

export default class DynamicWallpaperExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._background = new Gio.Settings({schema_id: 'org.gnome.desktop.background'});
        this._interface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});

        this._timeoutId = 0;
        this._lastPhase = null;

        // Any change in our settings: re-apply straight away.
        this._settingsChangedId = this._settings.connect('changed', () => {
            this._lastPhase = null;
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

        this._update();
    }

    // This extension uses the 'unlock-dialog' session mode: it keeps running
    // while the screen is locked, because the lock screen shows the desktop
    // wallpaper and a sunrise or sunset change should still happen on time.
    // It adds nothing to the lock screen itself.
    disable() {
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
        this._lastPhase = null;
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

    _readWallpapers() {
        const s = this._settings;
        const useTransitions = s.get_boolean('use-transitions');
        return {
            day: s.get_string('wallpaper-day'),
            night: s.get_string('wallpaper-night'),
            sunrise: useTransitions ? s.get_string('wallpaper-sunrise') : '',
            sunset: useTransitions ? s.get_string('wallpaper-sunset') : '',
        };
    }

    /** Apply the current phase (if it changed) and set the next timer. */
    _update() {
        const now = new Date();
        const {phase, nextChange} = getPhase(now, this._readConfig());

        // Only touch the wallpaper when the phase actually changes. That way
        // if you pick a different wallpaper in Settings by hand, it stays
        // until the next sunrise or sunset.
        if (phase !== this._lastPhase) {
            this._apply(phase);
            this._lastPhase = phase;
        }

        this._scheduleNext(now, nextChange);
    }

    _apply(phase) {
        const uri = wallpaperForPhase(phase, this._readWallpapers());
        if (uri) {
            // GNOME has separate wallpapers for light and dark style; set
            // both so it shows whichever style is active.
            this._setIfDifferent(this._background, 'picture-uri', uri);
            this._setIfDifferent(this._background, 'picture-uri-dark', uri);
        }

        if (this._settings.get_boolean('switch-style')) {
            const scheme = phase === Phase.NIGHT ? 'prefer-dark' : 'default';
            this._setIfDifferent(this._interface, 'color-scheme', scheme);
        }
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
