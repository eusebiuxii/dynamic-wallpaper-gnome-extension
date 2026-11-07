// SPDX-License-Identifier: GPL-2.0-or-later
// The "Dynamic set" tab of the settings window: any number of pictures placed
// around a 24-hour clock drawn as a rounded square.
//
//   - The track runs clockwise, evenly spaced in time: noon at the top
//     middle, 18:00 on the right, midnight at the bottom, 06:00 on the left.
//   - Its colour shows the sun on the preview date: light for day, an
//     orange gradient through sunrise and sunset, dark grey for night.
//   - Each picture is a dot. Click the track to add one, click a dot to see
//     it and change it in the middle of the square, drag a dot to move it
//     (in sun mode it snaps onto a label when dropped near one), right-click
//     a dot to remove it. Each picture's start time is written outside the
//     track, next to its dot.
//
// Like the rest of the settings window this only writes settings; the
// extension reads them (see lib/dynamicSet.js for the scheduling).

import Adw from 'gi://Adw';
import Cairo from 'cairo';
import Gdk from 'gi://Gdk';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';
import PangoCairo from 'gi://PangoCairo';

import {
    availableLabels, convertEntries, currentEntry, entryTimes, labelName, labelText, MAX_OFFSET,
    minutesOfDay, parseEntries, placeOnLabel, spreadEvenly, SUN_LABELS,
} from './lib/dynamicSet.js';
import {getSunAltitude} from './lib/sun.js';

const DAY_MINUTES = 24 * 60;
const CLOCK_SIZE = 540; // the clock widget is this many pixels square
const MARGIN = 54; // room around the track for picture times and "now"
const TRACK_WIDTH = 12;
const DOT_RADIUS = 9;
const HIT_RADIUS = 16; // how close a click must be to a dot or the track
const SUN_SNAP_MINUTES = 8; // sun mode: this close to a label snaps onto it
const TIME_SNAP_MINUTES = 15; // time mode: dragging and adding use these steps

// Track colours (RGB 0–1).
const DAY_COLOUR = [0.98, 0.91, 0.66];
const TWILIGHT_COLOUR = [0.95, 0.53, 0.24];
const NIGHT_COLOUR = [0.33, 0.33, 0.40];

const pad = n => String(n).padStart(2, '0');
const formatMinutes = m => `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`;
const formatDate = date => date.toLocaleDateString(undefined, {day: 'numeric', month: 'long'});
const sameDay = (a, b) => a.toDateString() === b.toDateString();
const noonOf = date => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12);
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

/** Track colour for a sun altitude in degrees. */
function skyColour(altitude) {
    if (altitude >= 6)
        return DAY_COLOUR;
    if (altitude >= 0)
        return mix(TWILIGHT_COLOUR, DAY_COLOUR, altitude / 6);
    if (altitude >= -6)
        return mix(NIGHT_COLOUR, TWILIGHT_COLOUR, (altitude + 6) / 6);
    return NIGHT_COLOUR;
}

/** A Gtk.Picture that's always the given size, whatever the image's shape. */
const FixedPicture = GObject.registerClass(
class DynamicWallpaperFixedPicture extends Gtk.Picture {
    constructor(width, height, props = {}) {
        super({
            content_fit: Gtk.ContentFit.COVER,
            css_classes: ['card'],
            overflow: Gtk.Overflow.HIDDEN,
            halign: Gtk.Align.CENTER,
            ...props,
        });
        this._size = [width, height];
    }

    vfunc_measure(orientation, _forSize) {
        const size = this._size[orientation === Gtk.Orientation.HORIZONTAL ? 0 : 1];
        return [size, size, -1, -1];
    }
});

// ------------------------------------------------------------- Thumbnails

const textures = new Map();

/**
 * A scaled-down texture of an image, cached. Small sizes use GNOME's
 * thumbnail cache when the Files app has already made one.
 */
function loadTexture(uri, width, height) {
    const key = `${width}x${height} ${uri}`;
    if (textures.has(key))
        return textures.get(key);
    let texture = null;
    try {
        const file = Gio.File.new_for_uri(uri);
        if (width <= 128) {
            const info = file.query_info('thumbnail::path,thumbnail::is-valid',
                Gio.FileQueryInfoFlags.NONE, null);
            const path = info.get_attribute_byte_string('thumbnail::path');
            if (path && info.get_attribute_boolean('thumbnail::is-valid'))
                texture = Gdk.Texture.new_from_filename(path);
        }
        if (!texture) {
            const pixbuf = GdkPixbuf.Pixbuf.new_from_file_at_scale(file.get_path(), width, height, true);
            texture = Gdk.Texture.new_for_pixbuf(pixbuf);
        }
    } catch {
        texture = null; // missing or unreadable: no thumbnail
    }
    textures.set(key, texture);
    return texture;
}

/**
 * Loads thumbnails one at a time when GTK is idle, so a folder of large
 * images doesn't freeze the window.
 */
class ThumbnailQueue {
    constructor() {
        this._queue = [];
        this._id = 0;
    }

    add(picture, uri, width, height) {
        this._queue.push({picture, uri, width, height});
        if (!this._id)
            this._id = GLib.idle_add(GLib.PRIORITY_LOW, () => this._next());
    }

    _next() {
        const job = this._queue.shift();
        if (job && job.picture.get_root())
            job.picture.set_paintable(loadTexture(job.uri, job.width, job.height));
        if (this._queue.length)
            return GLib.SOURCE_CONTINUE;
        this._id = 0;
        return GLib.SOURCE_REMOVE;
    }

    clear() {
        this._queue = [];
        if (this._id)
            GLib.source_remove(this._id);
        this._id = 0;
    }
}

/** The images in a folder, sorted by name the way people expect (2 before 10). */
function listImages(folderUri) {
    const folder = Gio.File.new_for_uri(folderUri);
    const images = [];
    try {
        const children = folder.enumerate_children(
            'standard::name,standard::content-type,standard::is-hidden',
            Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = children.next_file(null))) {
            if (!info.get_is_hidden() && info.get_content_type()?.startsWith('image/'))
                images.push(info.get_name());
        }
        children.close(null);
    } catch {
        return [];
    }
    images.sort((a, b) => a.localeCompare(b, undefined, {numeric: true, sensitivity: 'base'}));
    return images.map(name => folder.get_child(name).get_uri());
}

const basename = uri => Gio.File.new_for_uri(uri).get_basename();

// ------------------------------------------------------------------- Page

/**
 * Builds the tab.
 *
 * @param {Adw.PreferencesWindow} window
 * @param {Gio.Settings} settings
 * @param {Function} watch connects a settings signal, disconnected on close
 */
export function buildDynamicSetPage(window, settings, watch) {
    const page = new Adw.PreferencesPage({
        name: 'dynamic-set',
        title: 'Dynamic set',
        icon_name: 'view-app-grid-symbolic',
    });
    const clock = new SetClock(window, settings, watch);

    // --- Top: on/off, time or sun, folder
    const top = new Adw.PreferencesGroup({
        title: 'Dynamic set',
        description: 'Any number of pictures spread around the day. Click the ' +
            'track to add a picture, click a dot to change it, drag a dot to ' +
            'move it, right-click a dot to remove it. Time of day moves in ' +
            '15-minute steps (use the time in the middle for exact minutes). ' +
            'Sun snaps onto a sun label (dawn, sunrise, midday…) when it gets close.',
    });

    const use = new Adw.SwitchRow({
        title: 'Use the dynamic set',
        subtitle: 'Instead of the day and night wallpapers on the Wallpapers tab',
    });
    settings.bind('use-set', use, 'active', Gio.SettingsBindFlags.DEFAULT);
    top.add(use);

    const modeRow = new Adw.ActionRow({title: 'Schedule by'});
    const modes = new Adw.ToggleGroup({valign: Gtk.Align.CENTER});
    modes.add(new Adw.Toggle({name: 'time', label: 'Time of day'}));
    modes.add(new Adw.Toggle({name: 'sun', label: 'Sun'}));
    modeRow.add_suffix(modes);
    top.add(modeRow);

    const syncMode = () => {
        const mode = settings.get_string('set-mode');
        if (modes.get_active_name() !== mode)
            modes.set_active_name(mode);
        const place = settings.get_string('location-name') || 'your location';
        modeRow.set_subtitle(mode === 'sun'
            ? GLib.markup_escape_text(`Follows the sun at ${place}`, -1)
            : 'The same times every day');
    };
    modes.connect('notify::active-name', () => {
        const mode = modes.get_active_name();
        if (!mode || mode === settings.get_string('set-mode'))
            return;
        // Keep the pictures roughly where they are on today's clock.
        clock.setEntries(convertEntries(clock.entries, mode, noonOf(new Date()),
            settings.get_double('latitude'), settings.get_double('longitude')));
        settings.set_string('set-mode', mode);
    });
    watch('changed::set-mode', syncMode);
    watch('changed::location-name', syncMode);
    syncMode();

    top.add(folderRow(window, settings, watch));
    page.add(top);

    // --- The clock
    const clockGroup = new Adw.PreferencesGroup();
    clockGroup.add(clock.widget);
    page.add(clockGroup);

    // --- Below: preview date, spread evenly
    const below = new Adw.PreferencesGroup();
    const dateRow = new Adw.ActionRow({
        title: 'Preview date',
        tooltip_text: 'See how the day and the pictures move through the year',
    });
    const year = new Date().getFullYear();
    const dayOfYear = date => Math.round((noonOf(date) - new Date(year, 0, 1, 12)) / 86_400_000);
    const scale = new Gtk.Scale({
        adjustment: new Gtk.Adjustment({lower: 0, upper: 364, step_increment: 1, page_increment: 7}),
        draw_value: false,
        hexpand: true,
        width_request: 300,
        valign: Gtk.Align.CENTER,
    });
    for (const [month, name] of [[0, 'Jan'], [3, 'Apr'], [6, 'Jul'], [9, 'Oct']])
        scale.add_mark(dayOfYear(new Date(year, month, 1)), Gtk.PositionType.BOTTOM, name);
    const today = new Gtk.Button({
        icon_name: 'edit-undo-symbolic',
        tooltip_text: 'Back to today',
        valign: Gtk.Align.CENTER,
        css_classes: ['flat'],
    });
    dateRow.add_suffix(scale);
    dateRow.add_suffix(today);
    scale.connect('value-changed', () => {
        const date = new Date(year, 0, 1 + Math.round(scale.get_value()), 12);
        dateRow.set_subtitle(formatDate(date));
        today.set_sensitive(!sameDay(date, new Date()));
        clock.setPreviewDate(date);
    });
    today.connect('clicked', () => scale.set_value(dayOfYear(new Date())));
    scale.set_value(dayOfYear(new Date()));
    dateRow.set_subtitle(formatDate(new Date()));
    today.set_sensitive(false);
    below.add(dateRow);

    const spread = new Adw.ButtonRow({title: 'Space the pictures evenly'});
    spread.connect('activated', () => clock.setEntries(spreadEvenly(clock.entries)));
    below.add(spread);
    const syncSpread = () => spread.set_visible(settings.get_string('set-mode') === 'time');
    watch('changed::set-mode', syncSpread);
    syncSpread();
    page.add(below);

    // --- Fades (the same setting as on the Wallpapers tab)
    const changes = new Adw.PreferencesGroup({title: 'Changing wallpaper'});
    const fade = Adw.SpinRow.new_with_range(0, 120, 1);
    fade.set_title('Fade lasts (minutes)');
    fade.set_subtitle('Each picture fades in from the one before. 0 swaps straight away.');
    settings.bind('fade-minutes', fade, 'value', Gio.SettingsBindFlags.DEFAULT);
    changes.add(fade);
    page.add(changes);

    window.connect('close-request', () => {
        clock.destroy();
        return false;
    });
    // For tests/prefs-window.js.
    page._clock = clock;
    return page;
}

/** The "Picture folder" row: choose or clear the folder to pick from. */
function folderRow(window, settings, watch) {
    const row = new Adw.ActionRow({title: 'Picture folder'});
    const choose = new Gtk.Button({
        icon_name: 'folder-open-symbolic',
        tooltip_text: 'Choose a folder',
        valign: Gtk.Align.CENTER,
        css_classes: ['flat'],
    });
    const clear = new Gtk.Button({
        icon_name: 'edit-clear-symbolic',
        tooltip_text: 'Don\'t use a folder',
        valign: Gtk.Align.CENTER,
        css_classes: ['flat'],
    });
    row.add_suffix(choose);
    row.add_suffix(clear);
    row.set_activatable_widget(choose);

    const update = () => {
        const uri = settings.get_string('set-folder');
        const path = uri ? Gio.File.new_for_uri(uri).get_path() : null;
        row.set_subtitle(path
            ? GLib.markup_escape_text(path.replace(GLib.get_home_dir(), '~'), -1)
            : 'None: adding a picture opens the file picker. With a folder, ' +
              'you pick from its pictures instead.');
        clear.set_visible(Boolean(uri));
    };
    watch('changed::set-folder', update);
    update();

    clear.connect('clicked', () => settings.set_string('set-folder', ''));
    choose.connect('clicked', () => {
        const dialog = new Gtk.FileDialog({title: 'Choose a folder of pictures'});
        const current = settings.get_string('set-folder');
        dialog.set_initial_folder(current ? Gio.File.new_for_uri(current)
            : Gio.File.new_for_path(GLib.get_user_special_dir(
                GLib.UserDirectory.DIRECTORY_PICTURES) ?? GLib.get_home_dir()));
        dialog.select_folder(window, null, (_d, result) => {
            try {
                const folder = dialog.select_folder_finish(result);
                if (folder)
                    settings.set_string('set-folder', folder.get_uri());
            } catch (e) {
                if (!e.matches(Gtk.DialogError, Gtk.DialogError.DISMISSED))
                    logError(e, 'Dynamic Wallpaper: choosing a folder failed');
            }
        });
    });
    return row;
}

// ------------------------------------------------------------------ Clock

/**
 * The square clock: a drawing area for the track and dots, with the
 * selected picture's details laid over its middle.
 */
class SetClock {
    constructor(window, settings, watch) {
        this._window = window;
        this._settings = settings;
        this._watch = watch;
        this.entries = parseEntries(settings.get_string('set-images'));
        this._selected = -1;
        this._previewDate = noonOf(new Date());
        this._drag = null;
        this._thumbs = new ThumbnailQueue();
        this._updating = false;

        this._area = new Gtk.DrawingArea({
            content_width: CLOCK_SIZE,
            content_height: CLOCK_SIZE,
            has_tooltip: true,
        });
        this._area.set_draw_func((_a, cr, width, height) => {
            try {
                this._draw(cr, width, height);
            } finally {
                cr.$dispose();
            }
        });

        this._panel = this._buildPanel();
        // While dragging, a small tag next to the dot says where it will
        // land. It sits on a layer above everything that ignores the mouse.
        this._tag = new Gtk.Label({css_classes: ['osd', 'dw-drag-tag'], visible: false});
        this._tagLayer = new Gtk.Fixed({can_target: false});
        this._tagLayer.put(this._tag, 0, 0);
        const css = new Gtk.CssProvider();
        css.load_from_string('.dw-drag-tag { padding: 3px 9px; border-radius: 99px; font-weight: bold; }' +
            '.dw-drag-tag.snapped { background-color: @accent_bg_color; color: @accent_fg_color; }');
        Gtk.StyleContext.add_provider_for_display(Gdk.Display.get_default(), css,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);

        const overlay = new Gtk.Overlay({halign: Gtk.Align.CENTER, child: this._area});
        overlay.add_overlay(this._panel);
        overlay.add_overlay(this._tagLayer);
        this.widget = overlay;

        this._popover = new Gtk.Popover({has_arrow: true});
        this._popover.set_parent(this._area);

        this._connectInput();

        watch('changed::set-images', () => {
            if (settings.get_string('set-images') === this._json())
                return;
            this.entries = parseEntries(settings.get_string('set-images'));
            this._select(Math.min(this._selected, this.entries.length - 1));
        });
        for (const key of ['set-mode', 'latitude', 'longitude'])
            watch(`changed::${key}`, () => this._changed());

        const style = Adw.StyleManager.get_default();
        this._styleIds = [
            style.connect('notify::dark', () => this._area.queue_draw()),
            style.connect('notify::accent-color', () => this._area.queue_draw()),
        ];

        // Keep the "now" marker moving.
        this._tickId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 60, () => {
            this._area.queue_draw();
            return GLib.SOURCE_CONTINUE;
        });

        this._select(-1);
    }

    destroy() {
        this._thumbs.clear();
        if (this._tickId)
            GLib.source_remove(this._tickId);
        this._tickId = 0;
        const style = Adw.StyleManager.get_default();
        this._styleIds.forEach(id => style.disconnect(id));
        this._styleIds = [];
        this._popover.unparent();
    }

    get _mode() {
        return this._settings.get_string('set-mode');
    }

    get _location() {
        return [this._settings.get_double('latitude'), this._settings.get_double('longitude')];
    }

    _set() {
        const [latitude, longitude] = this._location;
        return {mode: this._mode, latitude, longitude, entries: this.entries};
    }

    /** Replaces the pictures and saves them. */
    setEntries(entries) {
        this.entries = entries;
        this._save();
        this._changed();
    }

    setPreviewDate(date) {
        this._previewDate = noonOf(date);
        this._changed();
    }

    _json() {
        return JSON.stringify(this.entries.map(({uri, time, label, offset}) =>
            ({uri, time, label, offset})));
    }

    _save() {
        const json = this._json();
        if (this._settings.get_string('set-images') !== json)
            this._settings.set_string('set-images', json);
    }

    _changed() {
        this._area.queue_draw();
        this._updatePanel();
    }

    _select(index) {
        this._selected = index;
        this._changed();
    }

    // ------------------------------------------------------- Geometry

    _geometry() {
        const width = this._area.get_width() || CLOCK_SIZE;
        const height = this._area.get_height() || CLOCK_SIZE;
        const side = Math.min(width, height) - 2 * MARGIN;
        if (this._geom?.width === width && this._geom?.height === height)
            return this._geom;

        const x0 = (width - side) / 2;
        const y0 = (height - side) / 2;
        const r = side * 0.18;
        const L = side - 2 * r;
        const quarter = Math.PI * r / 2;
        const perimeter = 4 * L + 4 * quarter;

        // Walk the rounded square clockwise from the top middle (noon).
        const pointAt = s => {
            const pieces = [
                [L / 2, d => [x0 + side / 2 + d, y0]],
                [quarter, d => arc(x0 + side - r, y0 + r, -Math.PI / 2 + d / r)],
                [L, d => [x0 + side, y0 + r + d]],
                [quarter, d => arc(x0 + side - r, y0 + side - r, d / r)],
                [L, d => [x0 + side - r - d, y0 + side]],
                [quarter, d => arc(x0 + r, y0 + side - r, Math.PI / 2 + d / r)],
                [L, d => [x0, y0 + side - r - d]],
                [quarter, d => arc(x0 + r, y0 + r, Math.PI + d / r)],
                [L / 2, d => [x0 + r + d, y0]],
            ];
            for (const [length, at] of pieces) {
                if (s <= length)
                    return at(s);
                s -= length;
            }
            return [x0 + side / 2, y0];
        };
        const arc = (cx, cy, angle) => [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];

        // One point per minute; minute 720 (noon) is at the start.
        const points = [];
        for (let m = 0; m < DAY_MINUTES; m++)
            points.push(pointAt(((m - 720 + DAY_MINUTES) % DAY_MINUTES) / DAY_MINUTES * perimeter));

        this._geom = {width, height, x0, y0, side, r, points};
        return this._geom;
    }

    _point(minute) {
        const {points} = this._geometry();
        return points[((Math.round(minute) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES];
    }

    /** Unit vector pointing into the square at `minute`. */
    _inward(minute) {
        const [ax, ay] = this._point(minute - 2);
        const [bx, by] = this._point(minute + 2);
        const length = Math.hypot(bx - ax, by - ay) || 1;
        return [-(by - ay) / length, (bx - ax) / length];
    }

    /** The minute of the track point nearest (x, y), and how far away it is. */
    _nearestMinute(x, y) {
        const {points} = this._geometry();
        let best = 0;
        let bestDistance = Infinity;
        points.forEach(([px, py], m) => {
            const distance = Math.hypot(px - x, py - y);
            if (distance < bestDistance) {
                best = m;
                bestDistance = distance;
            }
        });
        return {minute: best, distance: bestDistance};
    }

    /** Where each picture sits on the preview date. */
    _dots() {
        const times = entryTimes(this._previewDate, this._set());
        return this.entries.map((entry, index) => {
            const time = times[index];
            const minute = time ? minutesOfDay(time) : entry.time;
            const [x, y] = this._point(minute);
            return {index, minute, available: Boolean(time), x, y};
        });
    }

    _dotAt(x, y) {
        const dots = this._dots();
        // The selected dot is drawn on top, so it wins.
        const order = [...dots].sort((a, b) => (a.index === this._selected) - (b.index === this._selected));
        let found = null;
        for (const dot of order) {
            if (Math.hypot(dot.x - x, dot.y - y) <= HIT_RADIUS)
                found = dot;
        }
        return found;
    }

    /**
     * Sun mode: where a minute on the clock sits relative to the sun on the
     * preview date, snapping onto a label when it's close.
     */
    _placeOnSun(minute) {
        const [latitude, longitude] = this._location;
        return placeOnLabel(minute, this._previewDate, latitude, longitude, SUN_SNAP_MINUTES);
    }

    _labelMinute(label) {
        const [latitude, longitude] = this._location;
        const found = availableLabels(this._previewDate, latitude, longitude).find(l => l.id === label);
        return found ? minutesOfDay(found.time) : null;
    }

    // ---------------------------------------------------------- Drawing

    _draw(cr, width, height) {
        const geom = this._geometry();
        const fg = this._area.get_color();
        const accent = Adw.StyleManager.get_default().get_accent_color_rgba();
        const dark = Adw.StyleManager.get_default().get_dark();
        const [latitude, longitude] = this._location;

        cr.setLineCap(Cairo.LineCap.ROUND);
        cr.setLineJoin(Cairo.LineJoin.ROUND);

        // The track, coloured by how high the sun is.
        const day = this._previewDate;
        const step = 5;
        cr.setLineWidth(TRACK_WIDTH);
        for (let m = 0; m < DAY_MINUTES; m += step) {
            const when = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, m + step / 2);
            const [r, g, b] = skyColour(getSunAltitude(when, latitude, longitude));
            cr.setSourceRGB(r, g, b);
            cr.moveTo(...geom.points[m]);
            for (let i = 1; i <= step; i++)
                cr.lineTo(...geom.points[(m + i) % DAY_MINUTES]);
            cr.stroke();
        }

        // Hour ticks inside the track, and the four main times.
        cr.setLineWidth(1.5);
        for (let hour = 0; hour < 24; hour++) {
            const minute = hour * 60;
            const [x, y] = this._point(minute);
            const [nx, ny] = this._inward(minute);
            const start = TRACK_WIDTH / 2 + 3;
            const length = hour % 6 === 0 ? 8 : hour % 3 === 0 ? 5 : 3;
            cr.setSourceRGBA(fg.red, fg.green, fg.blue, hour % 3 === 0 ? 0.6 : 0.3);
            cr.moveTo(x + nx * start, y + ny * start);
            cr.lineTo(x + nx * (start + length), y + ny * (start + length));
            cr.stroke();
            if (hour % 3 === 0) {
                const layout = this._area.create_pango_layout(formatMinutes(minute));
                layout.set_font_description(Pango.FontDescription.from_string('Sans 8'));
                const [w, h] = layout.get_pixel_size();
                const d = start + length + 4 + Math.max(w, h) / 2;
                cr.setSourceRGBA(fg.red, fg.green, fg.blue, 0.55);
                cr.moveTo(x + nx * d - w / 2, y + ny * d - h / 2);
                PangoCairo.show_layout(cr, layout);
            }
        }

        // Sun mode: marks where each label falls, so you can see where
        // pictures will snap to. They grow while you drag, and the one a
        // picture has snapped onto gets a ring.
        if (this._mode === 'sun') {
            const dragging = this._drag?.moved && this._drag.index >= 0;
            const dragged = dragging ? this.entries[this._drag.index] : null;
            for (const label of availableLabels(day, latitude, longitude)) {
                const minute = minutesOfDay(label.time);
                const [x, y] = this._point(minute);
                const [nx, ny] = this._inward(minute);
                // A short tick across the track (not a dot, so it isn't
                // mistaken for a picture), dark on the light parts of the
                // track and light on the dark parts.
                const [r, g, b] = skyColour(getSunAltitude(label.time, latitude, longitude));
                const light = 0.299 * r + 0.587 * g + 0.114 * b > 0.55;
                if (light)
                    cr.setSourceRGBA(0.15, 0.13, 0.12, dragging ? 0.8 : 0.55);
                else
                    cr.setSourceRGBA(1, 1, 1, dragging ? 0.85 : 0.6);
                const half = TRACK_WIDTH / 2 + (dragging ? 2 : -1.5);
                cr.setLineWidth(dragging ? 3 : 2);
                cr.moveTo(x - nx * half, y - ny * half);
                cr.lineTo(x + nx * half, y + ny * half);
                cr.stroke();
                if (dragged && dragged.label === label.id && !dragged.offset) {
                    cr.setSourceRGBA(accent.red, accent.green, accent.blue, 0.9);
                    cr.setLineWidth(2);
                    cr.arc(x, y, DOT_RADIUS + 7, 0, 2 * Math.PI);
                    cr.stroke();
                }
            }
        }

        // "Now", on today's date: a small triangle outside the track.
        const now = new Date();
        if (sameDay(now, day)) {
            const minute = now.getHours() * 60 + now.getMinutes();
            const [x, y] = this._point(minute);
            const [nx, ny] = this._inward(minute);
            const tip = TRACK_WIDTH / 2 + 3;
            const base = tip + 9;
            const [tx, ty] = [-ny, nx];
            cr.setSourceRGBA(fg.red, fg.green, fg.blue, 0.85);
            cr.moveTo(x - nx * tip, y - ny * tip);
            cr.lineTo(x - nx * base + tx * 5, y - ny * base + ty * 5);
            cr.lineTo(x - nx * base - tx * 5, y - ny * base - ty * 5);
            cr.closePath();
            cr.fill();
        }

        // The dots, the selected one last so it's on top.
        const dots = this._dots().sort((a, b) =>
            (a.index === this._selected) - (b.index === this._selected));
        this._drawTimes(cr, dots, fg, accent);
        const background = dark ? [0.14, 0.14, 0.16] : [1, 1, 1];
        for (const dot of dots) {
            const selected = dot.index === this._selected;
            const radius = selected ? DOT_RADIUS + 2 : DOT_RADIUS;
            if (selected) {
                cr.setSourceRGBA(accent.red, accent.green, accent.blue, 0.35);
                cr.arc(dot.x, dot.y, radius + 6, 0, 2 * Math.PI);
                cr.fill();
            }
            cr.setSourceRGB(...background);
            cr.arc(dot.x, dot.y, radius + 2.5, 0, 2 * Math.PI);
            cr.fill();
            if (dot.available)
                cr.setSourceRGB(accent.red, accent.green, accent.blue);
            else
                cr.setSourceRGBA(fg.red, fg.green, fg.blue, 0.35);
            cr.arc(dot.x, dot.y, radius, 0, 2 * Math.PI);
            cr.fill();
        }
    }

    /**
     * Each picture's start time, written outside the track next to its dot.
     * Where two would overlap, the later one moves further out; if there's
     * no room at all it's left out (hover the dot to see it).
     */
    _drawTimes(cr, dots, fg, accent) {
        const placed = [];
        const overlaps = box => placed.some(p =>
            box.x < p.x + p.w && p.x < box.x + box.w && box.y < p.y + p.h && p.y < box.y + box.h);
        // The selected one first, so it always gets a place.
        const order = [...dots].sort((a, b) =>
            (b.index === this._selected) - (a.index === this._selected) || a.minute - b.minute);
        const font = Pango.FontDescription.from_string('Sans 8');
        const bold = Pango.FontDescription.from_string('Sans Bold 8');

        for (const dot of order) {
            const selected = dot.index === this._selected;
            const layout = this._area.create_pango_layout(formatMinutes(dot.minute));
            layout.set_font_description(selected ? bold : font);
            const [w, h] = layout.get_pixel_size();
            const [nx, ny] = this._inward(dot.minute);
            for (const extra of [0, 14, 28]) {
                // Distance from the track's centre line to the label's
                // centre, outwards, far enough that the label clears the dot.
                const d = DOT_RADIUS + 6 + extra + Math.abs(nx) * w / 2 + Math.abs(ny) * h / 2;
                const box = {x: dot.x - nx * d - w / 2, y: dot.y - ny * d - h / 2, w, h};
                if (overlaps(box))
                    continue;
                placed.push(box);
                if (selected)
                    cr.setSourceRGB(accent.red, accent.green, accent.blue);
                else
                    cr.setSourceRGBA(fg.red, fg.green, fg.blue, dot.available ? 0.8 : 0.4);
                cr.moveTo(box.x, box.y);
                PangoCairo.show_layout(cr, layout);
                break;
            }
        }
    }

    // ------------------------------------------------------------ Input

    _connectInput() {
        const drag = new Gtk.GestureDrag({button: Gdk.BUTTON_PRIMARY});
        drag.connect('drag-begin', (_g, x, y) => this._dragBegin(x, y));
        drag.connect('drag-update', (_g, dx, dy) => this._dragUpdate(dx, dy));
        drag.connect('drag-end', (_g, dx, dy) => this._dragEnd(dx, dy));
        this._area.add_controller(drag);

        const right = new Gtk.GestureClick({button: Gdk.BUTTON_SECONDARY});
        right.connect('pressed', (_g, _n, x, y) => {
            const dot = this._dotAt(x, y);
            if (dot)
                this._remove(dot.index);
        });
        this._area.add_controller(right);

        const motion = new Gtk.EventControllerMotion();
        motion.connect('motion', (_m, x, y) => {
            const overTrack = this._dotAt(x, y) ||
                this._nearestMinute(x, y).distance <= HIT_RADIUS;
            this._area.set_cursor_from_name(overTrack ? 'pointer' : null);
        });
        this._area.add_controller(motion);

        this._area.connect('query-tooltip', (_a, x, y, _keyboard, tooltip) => {
            const dot = this._dotAt(x, y);
            if (dot) {
                const entry = this.entries[dot.index];
                const when = this._mode === 'sun'
                    ? `${labelText(entry)} · ${dot.available ? formatMinutes(dot.minute) : 'not on this date'}`
                    : formatMinutes(dot.minute);
                tooltip.set_text(`${basename(entry.uri)}\n${when}`);
                return true;
            }
            if (this._nearestMinute(x, y).distance <= HIT_RADIUS) {
                const {minute} = this._nearestMinute(x, y);
                if (this._mode === 'sun') {
                    const place = this._placeOnSun(minute);
                    const at = formatMinutes(this._sunMinute(place) ?? minute);
                    tooltip.set_text(`${labelText(place)} · ${at}\nClick to add a picture here`);
                } else {
                    tooltip.set_text(`${formatMinutes(this._snapTime(minute))}\nClick to add a picture here`);
                }
                return true;
            }
            return false;
        });
    }

    /** Time mode: the nearest 15-minute step. */
    _snapTime(minute) {
        return (Math.round(minute / TIME_SNAP_MINUTES) * TIME_SNAP_MINUTES) % DAY_MINUTES;
    }

    /** The clock minute of a sun placement ({label, offset}) on the preview date. */
    _sunMinute({label, offset}) {
        const at = this._labelMinute(label);
        return at === null ? null : (((at + offset) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
    }

    /** Shows the drag tag next to the dragged dot, outside the track. */
    _showTag(index) {
        const dot = this._dots()[index];
        const entry = this.entries[index];
        if (!dot || !entry) {
            this._tag.set_visible(false);
            return;
        }
        const snapped = this._mode === 'sun' && !entry.offset;
        this._tag.set_label(this._mode === 'sun'
            ? `${labelText(entry)} · ${formatMinutes(dot.minute)}`
            : formatMinutes(dot.minute));
        if (snapped)
            this._tag.add_css_class('snapped');
        else
            this._tag.remove_css_class('snapped');
        this._tag.set_visible(true);

        // Put it inside the square, away from the track, so it's not hidden
        // by the pointer or the times outside. Keep it within the widget.
        const [, natural] = this._tag.get_preferred_size();
        const [nx, ny] = this._inward(dot.minute);
        const d = DOT_RADIUS + 22 + Math.abs(nx) * natural.width / 2 + Math.abs(ny) * natural.height / 2;
        const width = this._area.get_width() || CLOCK_SIZE;
        const height = this._area.get_height() || CLOCK_SIZE;
        const x = Math.max(0, Math.min(width - natural.width, dot.x + nx * d - natural.width / 2));
        const y = Math.max(0, Math.min(height - natural.height, dot.y + ny * d - natural.height / 2));
        this._tagLayer.move(this._tag, x, y);
    }

    _dragBegin(x, y) {
        const dot = this._dotAt(x, y);
        if (dot) {
            this._drag = {x, y, index: dot.index, moved: false};
            this._select(dot.index);
            return;
        }
        const near = this._nearestMinute(x, y);
        this._drag = {x, y, index: -1, moved: false,
            onTrack: near.distance <= HIT_RADIUS, minute: near.minute};
    }

    _dragUpdate(dx, dy) {
        const drag = this._drag;
        if (!drag || drag.index < 0)
            return;
        if (!drag.moved && Math.hypot(dx, dy) < 4)
            return;
        drag.moved = true;
        const {minute} = this._nearestMinute(drag.x + dx, drag.y + dy);
        const entry = this.entries[drag.index];
        if (this._mode === 'sun') {
            // The dot follows the pointer, and jumps onto a label when it
            // gets close to one.
            Object.assign(entry, this._placeOnSun(minute));
            entry.time = minute;
        } else {
            entry.time = this._snapTime(minute);
        }
        // Saved when the drag ends: saving on every move would make the
        // extension rewrite the wallpaper over and over.
        this._changed();
        this._showTag(drag.index);
    }

    _dragEnd(dx, dy) {
        const drag = this._drag;
        this._drag = null;
        this._tag.set_visible(false);
        if (!drag)
            return;
        if (drag.index >= 0) {
            if (drag.moved) {
                this._save();
                this._area.queue_draw();
            }
            return;
        }
        if (Math.hypot(dx, dy) >= 4)
            return;
        if (drag.onTrack)
            this._add(drag.minute, drag.x, drag.y);
        else
            this._select(-1);
    }

    /** Adds a picture at `minute`: pick an image, then place it. */
    _add(minute, x, y) {
        const {label, offset} = this._placeOnSun(minute);
        const entry = this._mode === 'sun'
            ? {time: this._sunMinute({label, offset}) ?? minute, label, offset}
            : {time: this._snapTime(minute), label, offset: 0};

        this._chooseImage(x, y, uri => {
            this.entries.push({uri, ...entry});
            this._save();
            this._select(this.entries.length - 1);
        });
    }

    _remove(index) {
        this.entries.splice(index, 1);
        this._save();
        this._select(-1);
    }

    /**
     * Asks for an image: from the folder (a grid of thumbnails pointing at
     * (x, y) on the clock) if one is set, otherwise the file picker.
     */
    _chooseImage(x, y, done) {
        const folder = this._settings.get_string('set-folder');
        if (!folder) {
            this._openFileDialog(null, done);
            return;
        }

        this._thumbs.clear();
        const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 8});
        box.append(new Gtk.Label({label: 'Choose a picture', css_classes: ['heading']}));

        const images = listImages(folder);
        if (images.length) {
            const grid = new Gtk.FlowBox({
                selection_mode: Gtk.SelectionMode.NONE,
                min_children_per_line: 3,
                max_children_per_line: 4,
                column_spacing: 6,
                row_spacing: 6,
                homogeneous: true,
            });
            for (const uri of images) {
                const picture = new FixedPicture(104, 64);
                const button = new Gtk.Button({
                    child: picture,
                    tooltip_text: basename(uri),
                    css_classes: ['flat'],
                });
                button.connect('clicked', () => {
                    this._popover.popdown();
                    done(uri);
                });
                grid.append(button);
                this._thumbs.add(picture, uri, 128, 80);
            }
            const scroll = new Gtk.ScrolledWindow({
                child: grid,
                hscrollbar_policy: Gtk.PolicyType.NEVER,
                propagate_natural_height: true,
                max_content_height: 320,
                min_content_width: 480,
            });
            box.append(scroll);
        } else {
            box.append(new Gtk.Label({
                label: 'No pictures in this folder',
                css_classes: ['dim-label'],
                margin_top: 12,
                margin_bottom: 12,
            }));
        }

        const browse = new Gtk.Button({label: 'Browse…', halign: Gtk.Align.END});
        browse.connect('clicked', () => {
            this._popover.popdown();
            this._openFileDialog(folder, done);
        });
        box.append(browse);

        this._popover.set_child(box);
        const rect = new Gdk.Rectangle({x: Math.round(x), y: Math.round(y), width: 1, height: 1});
        this._popover.set_pointing_to(rect);
        this._popover.popup();
    }

    _openFileDialog(folderUri, done) {
        const filter = new Gtk.FileFilter({name: 'Images'});
        filter.add_pixbuf_formats();
        const filters = new Gio.ListStore({item_type: Gtk.FileFilter});
        filters.append(filter);
        const dialog = new Gtk.FileDialog({
            title: 'Choose a picture',
            filters,
            default_filter: filter,
        });
        dialog.set_initial_folder(folderUri ? Gio.File.new_for_uri(folderUri)
            : Gio.File.new_for_path(GLib.get_user_special_dir(
                GLib.UserDirectory.DIRECTORY_PICTURES) ?? GLib.get_home_dir()));
        dialog.open(this._window, null, (_d, result) => {
            try {
                const file = dialog.open_finish(result);
                if (file)
                    done(file.get_uri());
            } catch (e) {
                if (!e.matches(Gtk.DialogError, Gtk.DialogError.DISMISSED))
                    logError(e, 'Dynamic Wallpaper: choosing a file failed');
            }
        });
    }

    // ------------------------------------------------------------ Panel

    /** The details shown in the middle of the square. */
    _buildPanel() {
        const panel = new Gtk.Stack({
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.CENTER,
            width_request: 250,
            transition_type: Gtk.StackTransitionType.CROSSFADE,
        });

        // Nothing selected.
        const idle = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 8});
        this._idleTitle = new Gtk.Label({css_classes: ['dim-label', 'caption-heading']});
        this._idlePicture = new FixedPicture(220, 138);
        this._idleName = new Gtk.Label({ellipsize: Pango.EllipsizeMode.MIDDLE, max_width_chars: 30});
        this._idleHint = new Gtk.Label({
            css_classes: ['dim-label'],
            wrap: true,
            justify: Gtk.Justification.CENTER,
            max_width_chars: 26,
        });
        [this._idleTitle, this._idlePicture, this._idleName, this._idleHint].forEach(w => idle.append(w));
        panel.add_named(idle, 'idle');

        // A picture selected.
        const edit = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 8});
        this._picture = new FixedPicture(220, 138);
        this._name = new Gtk.Label({
            ellipsize: Pango.EllipsizeMode.MIDDLE,
            max_width_chars: 30,
            css_classes: ['heading'],
        });

        const timeBox = new Gtk.Box({spacing: 6, halign: Gtk.Align.CENTER});
        const makeSpin = (max, step) => {
            const spin = new Gtk.SpinButton({
                adjustment: new Gtk.Adjustment({lower: 0, upper: max, step_increment: step}),
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
        this._hours = makeSpin(23, 1);
        this._minutes = makeSpin(59, 1);
        timeBox.append(new Gtk.Label({label: 'Starts at', css_classes: ['dim-label']}));
        timeBox.append(this._hours);
        timeBox.append(new Gtk.Label({label: ':'}));
        timeBox.append(this._minutes);
        const onTime = () => {
            const entry = this.entries[this._selected];
            if (this._updating || !entry)
                return;
            entry.time = this._hours.get_value_as_int() * 60 + this._minutes.get_value_as_int();
            this._save();
            this._area.queue_draw();
        };
        this._hours.connect('value-changed', onTime);
        this._minutes.connect('value-changed', onTime);

        const sunBox = new Gtk.Box({spacing: 6, halign: Gtk.Align.CENTER});
        this._labels = new Gtk.DropDown({model: Gtk.StringList.new([]), valign: Gtk.Align.CENTER});
        this._labelIds = [];
        this._offset = new Gtk.SpinButton({
            adjustment: new Gtk.Adjustment({lower: -MAX_OFFSET, upper: MAX_OFFSET, step_increment: 1}),
            width_chars: 4,
            valign: Gtk.Align.CENTER,
            tooltip_text: 'Minutes after the label (negative: before)',
        });
        this._offset.connect('output', () => {
            const value = this._offset.get_value_as_int();
            this._offset.set_text(value > 0 ? `+${value}` : `${value}`);
            return true;
        });
        this._offset.connect('value-changed', () => {
            const entry = this.entries[this._selected];
            if (this._updating || !entry)
                return;
            entry.offset = this._offset.get_value_as_int();
            this._save();
            this._changed();
        });
        sunBox.append(this._labels);
        sunBox.append(this._offset);
        sunBox.append(new Gtk.Label({label: 'min', css_classes: ['dim-label']}));
        this._labels.connect('notify::selected', () => {
            const entry = this.entries[this._selected];
            const id = this._labelIds[this._labels.get_selected()];
            if (this._updating || !entry || !id || id === entry.label)
                return;
            entry.label = id;
            entry.offset = 0;
            entry.time = this._labelMinute(id) ?? entry.time;
            this._save();
            this._changed();
        });

        this._when = new Gtk.Stack();
        this._when.add_named(timeBox, 'time');
        this._when.add_named(sunBox, 'sun');

        this._info = new Gtk.Label({
            css_classes: ['dim-label', 'caption'],
            wrap: true,
            justify: Gtk.Justification.CENTER,
            max_width_chars: 30,
        });

        const buttons = new Gtk.Box({spacing: 6, halign: Gtk.Align.CENTER});
        const change = new Gtk.Button({label: 'Change picture…'});
        change.connect('clicked', () => {
            const index = this._selected;
            const [x, y] = this._point(this._dots()[index]?.minute ?? 0);
            this._chooseImage(x, y, uri => {
                if (this.entries[index]) {
                    this.entries[index].uri = uri;
                    this._save();
                    this._changed();
                }
            });
        });
        const remove = new Gtk.Button({label: 'Remove', css_classes: ['destructive-action']});
        remove.connect('clicked', () => this._remove(this._selected));
        buttons.append(change);
        buttons.append(remove);

        [this._picture, this._name, this._when, this._info, buttons].forEach(w => edit.append(w));
        panel.add_named(edit, 'edit');
        return panel;
    }

    _updatePanel() {
        if (!this._panel)
            return;
        this._updating = true;
        try {
            const entry = this.entries[this._selected];
            if (entry)
                this._showEntry(entry);
            else
                this._showIdle();
        } finally {
            this._updating = false;
        }
    }

    _showIdle() {
        this._panel.set_visible_child_name('idle');
        const now = new Date();
        const index = this.entries.length ? currentEntry(now, this._set()) : -1;
        const entry = this.entries[index];
        this._idleTitle.set_visible(Boolean(entry));
        this._idlePicture.set_visible(Boolean(entry));
        this._idleName.set_visible(Boolean(entry));
        if (entry) {
            this._idleTitle.set_label('SHOWING NOW');
            this._idlePicture.set_paintable(loadTexture(entry.uri, 440, 276));
            this._idleName.set_label(basename(entry.uri));
            this._idleHint.set_label('Click a dot to change it, or the track to add another picture.');
        } else {
            this._idleHint.set_label(this.entries.length
                ? 'Click a dot to change it, or the track to add another picture.'
                : 'Click anywhere on the track to add a picture at that time of day.');
        }
    }

    _showEntry(entry) {
        this._panel.set_visible_child_name('edit');
        this._picture.set_paintable(loadTexture(entry.uri, 440, 276));
        this._name.set_label(basename(entry.uri));
        this._when.set_visible_child_name(this._mode);

        const dot = this._dots()[this._selected];
        const date = formatDate(this._previewDate);
        if (this._mode === 'time') {
            this._hours.set_value(Math.floor(entry.time / 60));
            this._minutes.set_value(entry.time % 60);
            this._info.set_label('Every day');
            return;
        }

        // Only offer the labels that happen on the preview date at this
        // location (plus the current one, so it can be shown).
        const [latitude, longitude] = this._location;
        const available = new Set(availableLabels(this._previewDate, latitude, longitude).map(l => l.id));
        const ids = SUN_LABELS.map(l => l.id).filter(id => available.has(id) || id === entry.label);
        // Replacing the list from inside the dropdown's own change signal
        // crashes GTK, so only replace it when it's actually different.
        if (ids.join() !== this._labelIds.join()) {
            this._labelIds = ids;
            this._labels.set_model(Gtk.StringList.new(ids.map(labelName)));
        }
        if (this._labels.get_selected() !== ids.indexOf(entry.label))
            this._labels.set_selected(ids.indexOf(entry.label));
        this._offset.set_value(entry.offset);

        const help = entry.offset ? labelText(entry)
            : SUN_LABELS.find(l => l.id === entry.label)?.help ?? '';
        this._info.set_label(dot?.available
            ? `${help}. On ${date}: from ${formatMinutes(dot.minute)}`
            : `${labelName(entry.label)} doesn’t happen on ${date} here, so this picture is skipped`);
    }

    /** For tests/prefs-window.js: select a dot by index. */
    select(index) {
        this._select(index);
    }
}
