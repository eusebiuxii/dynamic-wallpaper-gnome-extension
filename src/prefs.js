// SPDX-License-Identifier: GPL-2.0-or-later
// The settings window. It runs in its own process (not inside GNOME Shell),
// so it uses GTK 4 and libadwaita, like any other GNOME app.
//
// It never changes the wallpaper itself: it only writes settings. The
// extension notices the change and applies it.

import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import GWeather from 'gi://GWeather?version=4.0';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {getTodaysEvents, getPhase, Phase, startOfDay, wallpaperForPhase} from './lib/schedule.js';
import {entryTimes, labelText, parseEntries, setEvents} from './lib/dynamicSet.js';
import {buildDynamicSetPage, fadeWhenOff} from './dynamicSetPage.js';

const PHASE_LABELS = {
    [Phase.NIGHT]: 'Night',
    [Phase.SUNRISE]: 'Sunrise',
    [Phase.DAY]: 'Day',
    [Phase.SUNSET]: 'Sunset',
};

const MODES = ['sun', 'fixed'];
const STYLE_MODES = ['sun', 'twilight', 'fixed'];

/**
 * A picture that's always 72×46, whatever the image's shape. A plain
 * Gtk.Picture sizes itself to the image, so the rows wouldn't line up.
 */
const Thumbnail = GObject.registerClass(
class DynamicWallpaperThumbnail extends Gtk.Picture {
    vfunc_measure(orientation, _forSize) {
        const size = orientation === Gtk.Orientation.HORIZONTAL ? 72 : 46;
        return [size, size, -1, -1];
    }
});

const pad = n => String(n).padStart(2, '0');
const formatTime = date => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

export default class DynamicWallpaperPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        // Keep the settings object alive as long as the window is open.
        window._settings = settings;
        window.set_default_size(660, 860);

        // Every settings listener goes through watch(), so they can all be
        // disconnected when the window closes.
        const ids = [];
        this._watch = (signal, callback) => ids.push(settings.connect(signal, callback));
        window.connect('close-request', () => {
            ids.forEach(id => settings.disconnect(id));
            ids.length = 0;
            return false; // let the window close as normal
        });

        window.add(this._buildWallpapersPage(window, settings));
        window.add(buildDynamicSetPage(window, settings, this._watch));
        window.add(this._buildStylePage(settings));
        window.add(this._buildSchedulePage(settings));
    }

    // ---------------------------------------------------------------- Pages

    _buildWallpapersPage(window, settings) {
        const page = new Adw.PreferencesPage({
            name: 'wallpapers',
            title: 'Wallpapers',
            icon_name: 'image-x-generic-symbolic',
        });

        // When the Dynamic set tab is in use, these pictures aren't shown.
        const banner = new Adw.Banner({
            title: 'The dynamic set is in use, so these wallpapers aren’t shown',
            button_label: 'Use these instead',
        });
        settings.bind('use-set', banner, 'revealed', Gio.SettingsBindFlags.GET);
        banner.connect('button-clicked', () => settings.set_boolean('use-set', false));
        page.set_banner(banner);

        const main = new Adw.PreferencesGroup({
            title: 'Wallpapers',
            description: 'Pick an image for the day and one for the night.',
        });
        main.add(this._wallpaperRow(window, settings, 'wallpaper-day', 'Day'));
        main.add(this._wallpaperRow(window, settings, 'wallpaper-night', 'Night'));
        page.add(main);

        const transitions = new Adw.PreferencesGroup({
            title: 'Sunrise and sunset',
            description: 'Optional extra wallpapers for the start and end of the day. ' +
                'The sunrise one starts at dawn; the sunset one ends at dusk. ' +
                'Leave one empty to use the day wallpaper.',
        });
        const toggle = new Adw.SwitchRow({title: 'Use sunrise and sunset wallpapers'});
        settings.bind('use-transitions', toggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        transitions.add(toggle);

        const minutes = Adw.SpinRow.new_with_range(5, 240, 5);
        minutes.set_title('Show each for (minutes)');
        settings.bind('transition-minutes', minutes, 'value', Gio.SettingsBindFlags.DEFAULT);
        transitions.add(minutes);

        const sunrise = this._wallpaperRow(window, settings, 'wallpaper-sunrise', 'Sunrise');
        const sunset = this._wallpaperRow(window, settings, 'wallpaper-sunset', 'Sunset');
        transitions.add(sunrise);
        transitions.add(sunset);
        for (const row of [minutes, sunrise, sunset])
            settings.bind('use-transitions', row, 'sensitive', Gio.SettingsBindFlags.GET);
        page.add(transitions);

        const changes = new Adw.PreferencesGroup({
            title: 'Changing wallpaper',
            description: 'Each change fades slowly from the old wallpaper into ' +
                'the new one, starting at the time of the change.',
        });
        const fade = Adw.SpinRow.new_with_range(0, 120, 1);
        fade.set_title('Fade lasts (minutes)');
        fade.set_subtitle('0 swaps straight away');
        settings.bind('fade-minutes', fade, 'value', Gio.SettingsBindFlags.DEFAULT);
        changes.add(fade);
        page.add(changes);

        // Greyed out while the dynamic set is in use (the banner above
        // says so, with a button to switch back).
        for (const group of [main, transitions, changes]) {
            settings.bind('use-set', group, 'sensitive',
                Gio.SettingsBindFlags.GET | Gio.SettingsBindFlags.INVERT_BOOLEAN);
            fadeWhenOff(group);
        }

        return page;
    }

    _buildSchedulePage(settings) {
        const page = new Adw.PreferencesPage({
            name: 'schedule',
            title: 'Schedule',
            icon_name: 'preferences-system-time-symbolic',
        });

        // When to change
        const when = new Adw.PreferencesGroup({title: 'Change the wallpaper'});
        const mode = new Adw.ComboRow({
            title: 'Change',
            model: Gtk.StringList.new(['At sunrise and sunset', 'At set times']),
        });
        mode.set_selected(Math.max(0, MODES.indexOf(settings.get_string('mode'))));
        mode.connect('notify::selected', () =>
            settings.set_string('mode', MODES[mode.get_selected()]));
        when.add(mode);
        page.add(when);

        const location = this._buildLocationGroup(settings);
        location.set_description('Sunrise and sunset are worked out from this, for the ' +
            'wallpapers and the light/dark style. Search for a town or city near you, ' +
            'or type in the coordinates.');
        const times = this._buildTimesGroup(settings);
        page.add(location);
        page.add(times);

        // Today's preview: every wallpaper that shows today, with when.
        const today = new Adw.PreferencesGroup({title: 'Today'});
        page.add(today);
        let previewRows = [];
        const refreshPreview = () => {
            for (const row of previewRows)
                today.remove(row);
            const useSet = settings.get_boolean('use-set');
            today.set_description(useSet
                ? 'Using the dynamic set (Dynamic set tab).'
                : 'Using the day and night wallpapers (Wallpapers tab).');
            previewRows = useSet ? this._setPreviewRows(settings) : this._previewRows(settings);
            for (const row of previewRows)
                today.add(row);
        };

        const syncMode = () => {
            const isSun = settings.get_string('mode') === 'sun';
            const useSet = settings.get_boolean('use-set');
            // A sun-scheduled dynamic set needs the location even with set
            // times chosen here.
            location.set_visible(isSun || (useSet && settings.get_string('set-mode') === 'sun'));
            times.set_visible(!isSun);
            mode.set_selected(MODES.indexOf(settings.get_string('mode')));
            // These only apply to the day and night wallpapers.
            when.set_sensitive(!useSet);
            times.set_sensitive(!useSet);
            when.set_description(useSet
                ? 'The dynamic set is in use and has its own times (Dynamic set tab), ' +
                  'so this only applies to the day and night wallpapers.'
                : '');
        };

        this._watch('changed', (_s, key) => {
            if (['mode', 'use-set', 'set-mode'].includes(key))
                syncMode();
            refreshPreview();
        });

        // Keep "Now" up to date while the window is open.
        let lastMinute = -1;
        const tick = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 20, () => {
            const minute = Math.floor(Date.now() / 60_000);
            if (minute !== lastMinute) {
                lastMinute = minute;
                refreshPreview();
            }
            return GLib.SOURCE_CONTINUE;
        });
        page.connect('destroy', () => GLib.source_remove(tick));

        syncMode();
        refreshPreview();
        return page;
    }

    _buildStylePage(settings) {
        const page = new Adw.PreferencesPage({
            name: 'theme',
            title: 'Theme',
            icon_name: 'weather-clear-night-symbolic',
        });

        const main = new Adw.PreferencesGroup({
            title: 'Light and dark style',
            description: 'Optionally switch GNOME between light style during the day ' +
                'and dark style at night. Off by default: your style is left as it is.',
        });
        const enable = new Adw.SwitchRow({title: 'Switch light and dark style'});
        settings.bind('switch-style', enable, 'active', Gio.SettingsBindFlags.DEFAULT);
        main.add(enable);
        page.add(main);

        const when = new Adw.PreferencesGroup({
            title: 'When it’s dark',
            description: 'Sunrise, sunset, dawn and dusk use the location on the Schedule tab.',
        });
        const choice = new Adw.ComboRow({
            title: 'Dark style',
            model: Gtk.StringList.new(['From sunset to sunrise', 'From dusk to dawn', 'At set times']),
        });
        const syncChoice = () => {
            const index = STYLE_MODES.indexOf(settings.get_string('style-mode'));
            if (choice.get_selected() !== index)
                choice.set_selected(Math.max(0, index));
            const place = settings.get_string('location-name') || 'your location';
            choice.set_subtitle(settings.get_string('style-mode') === 'fixed' ? ''
                : GLib.markup_escape_text(`At ${place}`, -1));
            times.set_visible(settings.get_string('style-mode') === 'fixed');
        };
        choice.connect('notify::selected', () =>
            settings.set_string('style-mode', STYLE_MODES[choice.get_selected()]));
        when.add(choice);
        page.add(when);

        const times = new Adw.PreferencesGroup();
        times.add(this._timeRow(settings, 'style-day-start', 'Light style from'));
        times.add(this._timeRow(settings, 'style-night-start', 'Dark style from'));
        page.add(times);

        const today = new Adw.PreferencesGroup({title: 'Today'});
        page.add(today);
        let rows = [];
        const refresh = () => {
            rows.forEach(row => today.remove(row));
            rows = this._stylePreviewRows(settings);
            rows.forEach(row => today.add(row));
        };

        for (const group of [when, times, today])
            settings.bind('switch-style', group, 'sensitive', Gio.SettingsBindFlags.GET);
        this._watch('changed', (_s, key) => {
            if (['style-mode', 'location-name'].includes(key))
                syncChoice();
            refresh();
        });
        syncChoice();
        refresh();
        return page;
    }

    _stylePreviewRows(settings) {
        const styleMode = settings.get_string('style-mode');
        const config = {
            mode: styleMode === 'fixed' ? 'fixed' : 'sun',
            latitude: settings.get_double('latitude'),
            longitude: settings.get_double('longitude'),
            dayStart: settings.get_int('style-day-start'),
            nightStart: settings.get_int('style-night-start'),
            transitions: styleMode === 'twilight',
            transitionMinutes: 60,
        };
        const now = new Date();
        const dark = getPhase(now, config).phase === Phase.NIGHT;
        const rows = [];
        const row = (title, value, isNow) => {
            const r = new Adw.ActionRow({title});
            if (isNow) {
                r.add_suffix(new Gtk.Label({label: 'Now', valign: Gtk.Align.CENTER,
                    css_classes: ['accent', 'heading']}));
            }
            r.add_suffix(new Gtk.Label({label: value, valign: Gtk.Align.CENTER,
                css_classes: isNow ? ['numeric'] : ['dim-label', 'numeric']}));
            return r;
        };

        const {polar, events} = getTodaysEvents(now, config);
        if (polar) {
            rows.push(row(polar === 'day' ? 'Light style' : 'Dark style', 'all day', true));
            return rows;
        }
        const light = events.find(e => e.phase !== Phase.NIGHT)?.time;
        const night = events.find(e => e.phase === Phase.NIGHT)?.time;
        if (light)
            rows.push(row('Light style', `from ${formatTime(light)}`, !dark));
        if (night)
            rows.push(row('Dark style', `from ${formatTime(night)}`, dark));
        return rows;
    }

    // ------------------------------------------------------------- Location

    _buildLocationGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: 'Location',
            description: 'Sunrise and sunset are worked out from this. Search for a ' +
                'town or city near you, or type in the coordinates.',
        });

        const current = new Adw.ActionRow({title: 'Current location'});
        const updateCurrent = () => {
            const name = settings.get_string('location-name');
            const lat = settings.get_double('latitude').toFixed(4);
            const lon = settings.get_double('longitude').toFixed(4);
            current.set_subtitle(name ? `${name} (${lat}, ${lon})` : `${lat}, ${lon}`);
        };
        for (const key of ['location-name', 'latitude', 'longitude'])
            this._watch(`changed::${key}`, updateCurrent);
        updateCurrent();
        group.add(current);

        const search = new Adw.EntryRow({title: 'Search for a city'});
        group.add(search);
        const expander = new Adw.ExpanderRow({title: 'Enter coordinates by hand'});

        let resultRows = [];
        const showResults = places => {
            for (const row of resultRows)
                group.remove(row);
            resultRows = places.map(place => {
                const row = new Adw.ActionRow({
                    title: GLib.markup_escape_text(place.name, -1),
                    subtitle: GLib.markup_escape_text(
                        `${place.region} · ${place.lat.toFixed(2)}, ${place.lon.toFixed(2)}`, -1),
                    activatable: true,
                });
                row.add_suffix(new Gtk.Image({icon_name: 'find-location-symbolic'}));
                row.connect('activated', () => {
                    settings.set_double('latitude', place.lat);
                    settings.set_double('longitude', place.lon);
                    settings.set_string('location-name', `${place.name}, ${place.region}`);
                    search.set_text('');
                    showResults([]);
                });
                return row;
            });
            // Results go straight under the search box, so move the
            // coordinates row back to the end after them.
            group.remove(expander);
            for (const row of resultRows)
                group.add(row);
            group.add(expander);
        };

        let searchTimeout = 0;
        search.connect('changed', () => {
            if (searchTimeout)
                GLib.source_remove(searchTimeout);
            searchTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
                searchTimeout = 0;
                showResults(searchCities(search.get_text()));
                return GLib.SOURCE_REMOVE;
            });
        });
        search.connect('destroy', () => {
            if (searchTimeout)
                GLib.source_remove(searchTimeout);
        });

        // Typing coordinates by hand clears the place name, since it may no
        // longer match.
        const latitude = Adw.SpinRow.new_with_range(-90, 90, 0.0001);
        latitude.set_title('Latitude');
        latitude.set_subtitle('North is positive, south is negative');
        latitude.set_digits(4);
        const longitude = Adw.SpinRow.new_with_range(-180, 180, 0.0001);
        longitude.set_title('Longitude');
        longitude.set_subtitle('East is positive, west is negative');
        longitude.set_digits(4);

        expander.add_row(latitude);
        expander.add_row(longitude);
        group.add(expander);

        for (const [row, key] of [[latitude, 'latitude'], [longitude, 'longitude']]) {
            row.set_value(settings.get_double(key));
            this._watch(`changed::${key}`, () => {
                if (row.get_value() !== settings.get_double(key))
                    row.set_value(settings.get_double(key));
            });
            row.connect('notify::value', () => {
                if (row.get_value() === settings.get_double(key))
                    return;
                settings.set_double(key, row.get_value());
                settings.set_string('location-name', '');
            });
        }

        return group;
    }

    // ---------------------------------------------------------- Set times

    _buildTimesGroup(settings) {
        const group = new Adw.PreferencesGroup({
            title: 'Set times',
            description: 'With sunrise and sunset wallpapers on, the sunrise one shows ' +
                'from "Day starts" and the sunset one in the time before "Night starts" ' +
                '(set times have no dawn or dusk).',
        });
        group.add(this._timeRow(settings, 'day-start', 'Day starts'));
        group.add(this._timeRow(settings, 'night-start', 'Night starts'));
        return group;
    }

    /** A row with hour and minute spinners, stored as minutes after midnight. */
    _timeRow(settings, key, title) {
        const row = new Adw.ActionRow({title});

        const makeSpin = (max, step) => {
            const spin = new Gtk.SpinButton({
                adjustment: new Gtk.Adjustment({lower: 0, upper: max, step_increment: step}),
                orientation: Gtk.Orientation.VERTICAL,
                wrap: true,
                width_chars: 2,
                valign: Gtk.Align.CENTER,
            });
            spin.connect('output', () => {
                spin.set_text(pad(spin.get_value_as_int()));
                return true;
            });
            return spin;
        };
        const hours = makeSpin(23, 1);
        const minutes = makeSpin(59, 5);

        const box = new Gtk.Box({spacing: 6, valign: Gtk.Align.CENTER});
        box.append(hours);
        box.append(new Gtk.Label({label: ':'}));
        box.append(minutes);
        row.add_suffix(box);

        const load = () => {
            const value = settings.get_int(key);
            hours.set_value(Math.floor(value / 60));
            minutes.set_value(value % 60);
        };
        const save = () => {
            const value = hours.get_value_as_int() * 60 + minutes.get_value_as_int();
            if (value !== settings.get_int(key))
                settings.set_int(key, value);
        };
        load();
        hours.connect('value-changed', save);
        minutes.connect('value-changed', save);
        this._watch(`changed::${key}`, load);

        return row;
    }

    // ----------------------------------------------------------- Wallpapers

    /** A row showing a thumbnail of the wallpaper, with choose and clear buttons. */
    _wallpaperRow(window, settings, key, title) {
        const row = new Adw.ActionRow({title});

        const thumbnail = new Thumbnail({
            content_fit: Gtk.ContentFit.COVER,
            valign: Gtk.Align.CENTER,
            css_classes: ['card'],
            overflow: Gtk.Overflow.HIDDEN,
        });
        row.add_prefix(thumbnail);

        const choose = new Gtk.Button({
            icon_name: 'document-open-symbolic',
            tooltip_text: 'Choose an image',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        const clear = new Gtk.Button({
            icon_name: 'edit-clear-symbolic',
            tooltip_text: 'Remove',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        row.add_suffix(choose);
        row.add_suffix(clear);
        row.set_activatable_widget(choose);

        const update = () => {
            const uri = settings.get_string(key);
            const file = uri ? Gio.File.new_for_uri(uri) : null;
            row.set_subtitle(file ? GLib.markup_escape_text(file.get_basename(), -1) : 'Not set');
            thumbnail.set_paintable(file ? loadThumbnail(file) : null);
            clear.set_visible(Boolean(uri));
        };
        this._watch(`changed::${key}`, update);
        update();

        clear.connect('clicked', () => settings.set_string(key, ''));
        choose.connect('clicked', () => {
            const filter = new Gtk.FileFilter({name: 'Images'});
            filter.add_pixbuf_formats();
            const filters = new Gio.ListStore({item_type: Gtk.FileFilter});
            filters.append(filter);

            const dialog = new Gtk.FileDialog({
                title: `Choose the ${title.toLowerCase()} wallpaper`,
                filters,
                default_filter: filter,
            });
            const current = settings.get_string(key);
            if (current)
                dialog.set_initial_file(Gio.File.new_for_uri(current));
            else
                dialog.set_initial_folder(Gio.File.new_for_path(
                    GLib.get_user_special_dir(GLib.UserDirectory.DIRECTORY_PICTURES) ??
                    GLib.get_home_dir()));

            dialog.open(window, null, (_dialog, result) => {
                try {
                    const file = dialog.open_finish(result);
                    if (file)
                        settings.set_string(key, file.get_uri());
                } catch (e) {
                    // Cancelling the dialog lands here too; nothing to do.
                    if (!e.matches(Gtk.DialogError, Gtk.DialogError.DISMISSED))
                        logError(e, 'Dynamic Wallpaper: choosing a file failed');
                }
            });
        });

        return row;
    }

    // -------------------------------------------------------------- Preview

    _previewRows(settings) {
        const config = {
            mode: settings.get_string('mode'),
            latitude: settings.get_double('latitude'),
            longitude: settings.get_double('longitude'),
            dayStart: settings.get_int('day-start'),
            nightStart: settings.get_int('night-start'),
            transitions: settings.get_boolean('use-transitions'),
            transitionMinutes: settings.get_int('transition-minutes'),
        };
        const wallpapers = {
            day: settings.get_string('wallpaper-day'),
            night: settings.get_string('wallpaper-night'),
            sunrise: config.transitions ? settings.get_string('wallpaper-sunrise') : '',
            sunset: config.transitions ? settings.get_string('wallpaper-sunset') : '',
        };
        // The same fallbacks as the extension: one picture shows all day.
        wallpapers.day ||= wallpapers.night;
        wallpapers.night ||= wallpapers.day;

        const now = new Date();
        const {phase} = getPhase(now, config);
        const {polar, events} = getTodaysEvents(now, config);
        if (polar) {
            return [previewRow({
                uri: wallpaperForPhase(phase, wallpapers),
                title: `${PHASE_LABELS[phase]} wallpaper`,
                subtitle: polar === 'day' ? 'The sun doesn’t set today' : 'The sun doesn’t rise today',
                times: 'all day',
                now: true,
            })];
        }

        // Each phase lasts until the next; the last one until tomorrow's
        // first. Before today's first change, last night's phase is still
        // showing, so that comes first.
        const list = [...events];
        const yesterday = getTodaysEvents(startOfDay(now, -1), config).events.at(-1);
        if (yesterday && (!list.length || now < list[0].time))
            list.unshift({...yesterday, earlier: true});
        const tomorrow = getTodaysEvents(startOfDay(now, 1), config).events[0]?.time;
        return list.map((event, i) => {
            const end = list[i + 1]?.time ?? tomorrow;
            return previewRow({
                uri: wallpaperForPhase(event.phase, wallpapers),
                title: `${PHASE_LABELS[event.phase]} wallpaper`,
                times: end ? `${formatTime(event.time)} – ${formatTime(end)}` : `from ${formatTime(event.time)}`,
                now: now >= event.time && (!end || now < end),
                earlier: event.earlier,
            });
        });
    }

    /** The same preview for the dynamic set: one row per picture, in order. */
    _setPreviewRows(settings) {
        const set = {
            mode: settings.get_string('set-mode'),
            latitude: settings.get_double('latitude'),
            longitude: settings.get_double('longitude'),
            entries: parseEntries(settings.get_string('set-images')),
        };
        if (!set.entries.length) {
            return [new Adw.ActionRow({
                title: 'No pictures yet',
                subtitle: 'Add some on the Dynamic set tab.',
            })];
        }

        // Changes that start today, plus the one still showing from
        // yesterday, each lasting until the next.
        const now = new Date();
        const dayStart = startOfDay(now);
        const dayEnd = startOfDay(now, 1);
        const events = setEvents(now, set);
        const rows = [];
        events.forEach((event, i) => {
            const next = events[i + 1];
            const startsToday = event.time >= dayStart && event.time < dayEnd;
            const carriedOver = event.time < dayStart && next && next.time > dayStart;
            if (!startsToday && !carriedOver)
                return;
            const entry = set.entries[Number(event.phase.slice(1))];
            const name = Gio.File.new_for_uri(entry.uri).get_basename();
            rows.push(previewRow({
                uri: entry.uri,
                title: set.mode === 'sun' ? labelText(entry) : name,
                subtitle: set.mode === 'sun' ? name : null,
                times: next ? `${formatTime(event.time)} – ${formatTime(next.time)}` : `from ${formatTime(event.time)}`,
                now: event.time <= now && (!next || now < next.time),
                earlier: carriedOver,
            }));
        });

        // Pictures whose sun label doesn't happen here today.
        const times = entryTimes(now, set);
        set.entries.forEach((entry, i) => {
            if (times[i])
                return;
            rows.push(previewRow({
                uri: entry.uri,
                title: labelText(entry),
                subtitle: 'Doesn’t happen here today, so it’s skipped',
                times: '',
            }));
        });
        return rows;
    }
}

/**
 * One row of the Today preview: thumbnail, what it is, when it shows, and a
 * "Now" tag on the one showing now.
 */
function previewRow({uri, title, subtitle = null, times, now = false, earlier = false}) {
    const row = new Adw.ActionRow({
        title: GLib.markup_escape_text(title, -1),
        subtitle: subtitle ? GLib.markup_escape_text(subtitle, -1) : '',
    });
    if (earlier)
        row.set_subtitle(GLib.markup_escape_text(`${subtitle ? `${subtitle} · ` : ''}started yesterday`, -1));
    const thumbnail = new Thumbnail({
        content_fit: Gtk.ContentFit.COVER,
        valign: Gtk.Align.CENTER,
        css_classes: ['card'],
        overflow: Gtk.Overflow.HIDDEN,
    });
    thumbnail.set_paintable(uri ? loadThumbnail(Gio.File.new_for_uri(uri)) : null);
    row.add_prefix(thumbnail);
    if (now) {
        row.add_suffix(new Gtk.Label({
            label: 'Now',
            valign: Gtk.Align.CENTER,
            css_classes: ['accent', 'heading'],
        }));
    }
    row.add_suffix(new Gtk.Label({
        label: times,
        valign: Gtk.Align.CENTER,
        css_classes: now ? ['numeric'] : ['dim-label', 'numeric'],
    }));
    return row;
}

// ------------------------------------------------------------------ Helpers


/**
 * A small thumbnail of an image. Loading it scaled down keeps memory low:
 * a 6K wallpaper at full size would take well over 100 MB.
 */
const thumbnails = new Map();

function loadThumbnail(file) {
    // Cached: the Today preview rebuilds its rows on every settings change.
    const uri = file.get_uri();
    if (!thumbnails.has(uri))
        thumbnails.set(uri, loadThumbnailUncached(file));
    return thumbnails.get(uri);
}

function loadThumbnailUncached(file) {
    try {
        const pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(file.get_path(), 216, 138, true);
        return Gdk.Texture.new_for_pixbuf(pixbuf);
    } catch {
        return null; // missing or unreadable file: just show no thumbnail
    }
}

let cities = null;

/**
 * Searches GNOME's built-in, offline list of places (the same one the
 * Weather and Clocks apps use). Loaded the first time you search.
 */
function searchCities(query) {
    query = query.trim().toLowerCase();
    if (query.length < 2)
        return [];

    if (cities === null)
        cities = loadCities();

    const starts = [];
    const contains = [];
    for (const city of cities) {
        const name = city.lowerName;
        if (name.startsWith(query))
            starts.push(city);
        else if (name.includes(query))
            contains.push(city);
        if (starts.length >= 8)
            break;
    }
    return [...starts, ...contains].slice(0, 8);
}

function loadCities() {
    const list = [];
    const walk = location => {
        let child = null;
        while ((child = location.next_child(child)) !== null) {
            const level = child.get_level();
            if (level === GWeather.LocationLevel.CITY) {
                const [lat, lon] = child.get_coords();
                const name = child.get_name();
                list.push({
                    name,
                    lowerName: name.toLowerCase(),
                    region: child.get_country_name() ?? '',
                    lat,
                    lon,
                });
            } else if (level < GWeather.LocationLevel.CITY) {
                walk(child);
            }
        }
    };
    walk(GWeather.Location.get_world());
    return list;
}
