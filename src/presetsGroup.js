// SPDX-License-Identifier: GPL-2.0-or-later
// The "Preset" row on the Dynamic set tab, above the clock: save the set as
// a preset, switch between saved presets, and manage the files.
//
// Opening a preset copies it into the settings (pictures, time or sun, fade
// length, picture folder) and remembers its file name in `set-preset`. The
// row compares the settings with that file to show whether there are unsaved
// changes; nothing is saved to the file until you press Save. See
// lib/presets.js for the file format.

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {convertEntries, parseEntries} from './lib/dynamicSet.js';
import {
    freeName, importPreset, listPresets, pathFor, presetsDir, readPreset, renamePreset,
    samePreset, trashPreset, writePreset,
} from './lib/presets.js';

const tilde = path => path.replace(GLib.get_home_dir(), '~');
const noonToday = () => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
};

/**
 * Builds the group.
 *
 * @param {Adw.PreferencesWindow} window
 * @param {Gio.Settings} settings
 * @param {Function} watch connects a settings signal, disconnected on close
 */
export function buildPresetsGroup(window, settings, watch) {
    const presets = new PresetsGroup(window, settings, watch);
    presets.group._presets = presets; // for tests/prefs-window.js
    return presets.group;
}

class PresetsGroup {
    constructor(window, settings, watch) {
        this._window = window;
        this._settings = settings;
        this._dir = presetsDir();
        this._presets = []; // from listPresets()
        this._items = []; // what the dropdown shows: {preset} or {none: true}
        this._updating = false;
        GLib.mkdir_with_parents(this._dir, 0o755);

        this.group = new Adw.PreferencesGroup({
            title: 'Presets',
            description: GLib.markup_escape_text(
                `Save the set below to switch back to it later. Kept in ${tilde(this._dir)}`, -1),
        });

        this._row = new Adw.ActionRow({title: 'Preset'});
        this._dropdown = new Gtk.DropDown({
            model: Gtk.StringList.new([]),
            valign: Gtk.Align.CENTER,
            tooltip_text: 'Open a saved preset',
        });
        this._saveButton = new Gtk.Button({
            label: 'Save',
            tooltip_text: 'Save changes to this preset',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        const menuButton = new Gtk.MenuButton({
            icon_name: 'view-more-symbolic',
            tooltip_text: 'More',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
            menu_model: this._buildMenu(),
        });
        this._row.add_suffix(this._dropdown);
        this._row.add_suffix(this._saveButton);
        this._row.add_suffix(menuButton);
        this.group.add(this._row);

        this._saveButton.connect('clicked', () => this._save());
        this._dropdown.connect('notify::selected', () => this._onPicked());

        for (const key of ['set-images', 'set-mode', 'set-folder', 'fade-minutes', 'set-preset'])
            watch(`changed::${key}`, () => this._sync());

        // Notice presets added, changed or removed in the folder (by Files,
        // or another settings window).
        this._monitor = Gio.File.new_for_path(this._dir).monitor_directory(Gio.FileMonitorFlags.NONE, null);
        this._monitorTimeout = 0;
        this._monitor.connect('changed', () => {
            if (this._monitorTimeout)
                GLib.source_remove(this._monitorTimeout);
            this._monitorTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
                this._monitorTimeout = 0;
                this._reload();
                return GLib.SOURCE_REMOVE;
            });
        });
        window.connect('close-request', () => {
            this._monitor.cancel();
            if (this._monitorTimeout)
                GLib.source_remove(this._monitorTimeout);
            this._monitorTimeout = 0;
            return false;
        });

        this._reload();
    }

    // ----------------------------------------------------------- State

    /** The set as it is in the settings, in lib/presets.js's shape. */
    _current() {
        const s = this._settings;
        return {
            name: '',
            mode: s.get_string('set-mode'),
            fadeMinutes: s.get_int('fade-minutes'),
            folder: s.get_string('set-folder'),
            entries: parseEntries(s.get_string('set-images')),
        };
    }

    /**
     * The preset the set was opened from, if its file is still there and
     * readable. Failing that, a preset with exactly these pictures (say the
     * one opened was deleted, but a copy is still saved).
     */
    _loaded() {
        const fileName = this._settings.get_string('set-preset');
        const opened = fileName
            ? this._presets.find(p => p.preset && GLib.path_get_basename(p.path) === fileName) : null;
        if (opened)
            return opened;
        const current = this._current();
        return current.entries.length
            ? this._presets.find(p => p.preset && samePreset(current, p.preset)) ?? null : null;
    }

    /** Whether the set has changes that aren't in any preset file. */
    _unsaved() {
        const current = this._current();
        const loaded = this._loaded();
        return loaded ? !samePreset(current, loaded.preset) : current.entries.length > 0;
    }

    _reload() {
        this._presets = listPresets(this._dir);
        this._sync();
    }

    /** Brings the dropdown, subtitle, buttons and menu up to date. */
    _sync() {
        const loaded = this._loaded();
        const current = this._current();
        const hasPictures = current.entries.length > 0;
        this._items = this._presets.map(preset => ({preset}));
        if (!loaded)
            this._items.unshift({none: true});
        const names = this._items.map(({preset, none}) =>
            none ? (hasPictures ? 'Not saved' : 'None') : preset.error ? `${preset.name} (can’t be read)` : preset.name);
        const selected = loaded ? this._items.findIndex(i => i.preset === loaded) : 0;

        this._updating = true;
        try {
            const model = this._dropdown.get_model();
            const old = [];
            for (let i = 0; i < model.get_n_items(); i++)
                old.push(model.get_string(i));
            // Replacing the list from inside the dropdown's own change
            // signal crashes GTK; _onPicked only calls this from an idle.
            if (old.join('\n') !== names.join('\n'))
                this._dropdown.set_model(Gtk.StringList.new(names));
            if (this._dropdown.get_selected() !== selected)
                this._dropdown.set_selected(selected);
        } finally {
            this._updating = false;
        }

        const unsaved = this._unsaved();
        let status;
        if (loaded)
            status = unsaved ? 'Changed since it was saved' : 'Saved';
        else if (!hasPictures)
            status = this._presets.length ? 'Open a preset, or add pictures and save them' : 'Add pictures below, then save them as a preset';
        else
            status = 'These pictures aren’t saved as a preset yet';
        this._row.set_subtitle(status);

        this._saveButton.set_sensitive(unsaved && hasPictures);
        this._saveButton.set_tooltip_text(loaded ? `Save changes to “${loaded.name}”` : 'Save as a new preset');
        this._dropdown.set_sensitive(this._items.length > 1 || (this._items.length === 1 && !this._items[0].none));
        this._actions.lookup_action('save-as').set_enabled(hasPictures);
        for (const name of ['rename', 'delete', 'show'])
            this._actions.lookup_action(name).set_enabled(Boolean(loaded));
    }

    // ----------------------------------------------------------- Menu

    _buildMenu() {
        this._actions = new Gio.SimpleActionGroup();
        const add = (name, callback) => {
            const action = new Gio.SimpleAction({name});
            action.connect('activate', callback);
            this._actions.add_action(action);
        };
        add('save-as', () => this._saveAs());
        add('import', () => this._import());
        add('rename', () => this._rename());
        add('delete', () => this._delete());
        add('open-folder', () => this._openFolder());
        add('show', () => this._showFile());
        this._window.insert_action_group('preset', this._actions);

        const menu = new Gio.Menu();
        const edit = new Gio.Menu();
        edit.append('Save as New Preset…', 'preset.save-as');
        edit.append('Open Preset File…', 'preset.import');
        edit.append('Rename…', 'preset.rename');
        edit.append('Delete', 'preset.delete');
        menu.append_section(null, edit);
        const files = new Gio.Menu();
        files.append('Open Presets Folder', 'preset.open-folder');
        files.append('Show Preset in Files', 'preset.show');
        menu.append_section(null, files);
        return menu;
    }

    // -------------------------------------------------------- Opening

    /** The dropdown changed: open that preset (asking about unsaved changes first). */
    _onPicked() {
        if (this._updating)
            return;
        const item = this._items[this._dropdown.get_selected()];
        // Opening a preset changes the settings, which rebuilds the
        // dropdown's list, and doing that inside the dropdown's own signal
        // crashes GTK. So carry on from an idle. The dropdown is put back
        // for now; it moves on once the preset opens.
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._sync();
            if (!item?.preset || item.preset === this._loaded())
                return GLib.SOURCE_REMOVE;
            if (item.preset.error)
                this._toast(`Can’t open “${item.preset.name}”: ${item.preset.error}`);
            else
                this._confirmLeaving(() => this._open(item.preset));
            return GLib.SOURCE_REMOVE;
        });
    }

    /**
     * Calls `next` once any unsaved changes are saved or let go, or not at
     * all if the person cancels.
     */
    _confirmLeaving(next) {
        if (!this._unsaved()) {
            next();
            return;
        }
        const loaded = this._loaded();
        const dialog = new Adw.AlertDialog({
            heading: loaded ? `Save changes to “${loaded.name}”?` : 'Save the current pictures?',
            body: loaded
                ? 'They haven’t been saved to the preset yet, and opening another preset replaces them.'
                : 'They aren’t saved as a preset, and opening one replaces them.',
            close_response: 'cancel',
            default_response: 'save',
        });
        dialog.add_response('cancel', 'Cancel');
        dialog.add_response('discard', 'Don’t Save');
        dialog.add_response('save', loaded ? 'Save' : 'Save as Preset…');
        dialog.set_response_appearance('discard', Adw.ResponseAppearance.DESTRUCTIVE);
        dialog.set_response_appearance('save', Adw.ResponseAppearance.SUGGESTED);
        dialog.connect('response', (_d, response) => {
            if (response === 'discard')
                next();
            else if (response === 'save' && loaded)
                this._save() && next();
            else if (response === 'save')
                this._saveAs(next);
        });
        dialog.present(this._window);
    }

    /** Copies a preset into the settings. */
    _open({path, preset}) {
        const s = this._settings;
        let {entries} = preset;
        // A sun preset stores no clock times: fill them in for today, so
        // the pictures land in sensible places if the set is switched to
        // time of day.
        if (preset.mode === 'sun') {
            entries = convertEntries(entries, 'time', noonToday(),
                s.get_double('latitude'), s.get_double('longitude'));
        }
        // All at once, so the extension rewrites the wallpaper only once.
        // delay() can't be undone, so it goes on a separate settings object
        // rather than the one the whole window uses.
        const batch = new Gio.Settings({settings_schema: s.settings_schema, path: s.path});
        batch.delay();
        batch.set_string('set-mode', preset.mode);
        batch.set_int('fade-minutes', preset.fadeMinutes);
        batch.set_string('set-folder', preset.folder);
        batch.set_string('set-images', JSON.stringify(entries.map(({uri, time, label, offset}) =>
            ({uri, time, label, offset}))));
        batch.set_string('set-preset', GLib.path_get_basename(path));
        batch.apply();
    }

    // --------------------------------------------------------- Saving

    /** Saves to the open preset, or asks for a name. @returns {boolean} saved */
    _save() {
        const loaded = this._loaded();
        if (!loaded) {
            this._saveAs();
            return false;
        }
        try {
            writePreset(loaded.path, {...this._current(), name: loaded.name});
        } catch (e) {
            this._toast(`Couldn’t save “${loaded.name}”: ${e.message}`);
            return false;
        }
        this._reload();
        this._toast(`Saved “${loaded.name}”`);
        return true;
    }

    /** Asks for a name and saves the set as a new preset. */
    _saveAs(then = null) {
        const loaded = this._loaded();
        const folder = this._settings.get_string('set-folder');
        const suggestion = loaded ? freeName(loaded.name, this._dir)
            : freeName(folder ? Gio.File.new_for_uri(folder).get_basename() : 'My Preset', this._dir);
        this._askName({
            heading: 'Save as New Preset',
            name: suggestion,
            action: 'Save',
            done: name => {
                const path = pathFor(name, this._dir);
                try {
                    writePreset(path, {...this._current(), name});
                } catch (e) {
                    this._toast(`Couldn’t save “${name}”: ${e.message}`);
                    return;
                }
                this._settings.set_string('set-preset', GLib.path_get_basename(path));
                this._reload();
                this._toast(`Saved “${name}”`);
                then?.();
            },
        });
    }

    _rename() {
        const loaded = this._loaded();
        if (!loaded)
            return;
        this._askName({
            heading: 'Rename Preset',
            name: loaded.name,
            action: 'Rename',
            current: loaded.path,
            done: name => {
                try {
                    const path = renamePreset(loaded.path, name);
                    this._settings.set_string('set-preset', GLib.path_get_basename(path));
                } catch (e) {
                    this._toast(`Couldn’t rename “${loaded.name}”: ${e.message}`);
                }
                this._reload();
            },
        });
    }

    /**
     * A dialog asking for a preset name. If the name belongs to another
     * preset, the button turns into "Replace".
     */
    _askName({heading, name, action, current = null, done}) {
        const entry = new Gtk.Entry({text: name, activates_default: true});
        const note = new Gtk.Label({
            css_classes: ['dim-label', 'caption'],
            wrap: true,
            xalign: 0,
            visible: false,
        });
        const box = new Gtk.Box({orientation: Gtk.Orientation.VERTICAL, spacing: 6});
        box.append(entry);
        box.append(note);

        const dialog = new Adw.AlertDialog({
            heading,
            extra_child: box,
            close_response: 'cancel',
            default_response: 'ok',
        });
        dialog.add_response('cancel', 'Cancel');
        dialog.add_response('ok', action);

        const check = () => {
            const text = entry.get_text().trim();
            const path = pathFor(text, this._dir);
            const clash = text && path !== current && GLib.file_test(path, GLib.FileTest.EXISTS);
            dialog.set_response_enabled('ok', Boolean(text));
            dialog.set_response_label('ok', clash ? 'Replace' : action);
            dialog.set_response_appearance('ok', clash
                ? Adw.ResponseAppearance.DESTRUCTIVE : Adw.ResponseAppearance.SUGGESTED);
            note.set_label(clash ? 'A preset with this name already exists. It will be replaced.' : '');
            note.set_visible(Boolean(clash));
        };
        entry.connect('changed', check);
        check();

        dialog.connect('response', (_d, response) => {
            if (response === 'ok' && entry.get_text().trim())
                done(entry.get_text().trim());
        });
        dialog.present(this._window);
        entry.grab_focus();
        entry.select_region(0, -1);
    }

    // ---------------------------------------------------- Other files

    /** Open file…: copies a preset from anywhere into the folder, then opens it. */
    _import() {
        const filter = new Gtk.FileFilter({name: 'Presets (JSON)'});
        filter.add_pattern('*.json');
        filter.add_mime_type('application/json');
        const filters = new Gio.ListStore({item_type: Gtk.FileFilter});
        filters.append(filter);
        const dialog = new Gtk.FileDialog({title: 'Open a Preset File', filters, default_filter: filter});
        dialog.open(this._window, null, (_d, result) => {
            let file;
            try {
                file = dialog.open_finish(result);
            } catch (e) {
                if (!e.matches(Gtk.DialogError, Gtk.DialogError.DISMISSED))
                    logError(e, 'Dynamic Wallpaper: choosing a preset failed');
                return;
            }
            const source = file?.get_path();
            if (!source)
                return;
            // Already in the folder: just open it.
            const inFolder = GLib.path_get_dirname(source) === this._dir;
            let path;
            try {
                path = inFolder ? source : importPreset(source, this._dir);
            } catch (e) {
                this._toast(`Can’t open “${file.get_basename()}”: ${e.message}`);
                return;
            }
            this._reload();
            const found = this._presets.find(p => p.path === path);
            if (found?.preset)
                this._confirmLeaving(() => this._open(found));
        });
    }

    _delete() {
        const loaded = this._loaded();
        if (!loaded)
            return;
        try {
            trashPreset(loaded.path);
        } catch (e) {
            this._toast(`Couldn’t delete “${loaded.name}”: ${e.message}`);
            return;
        }
        // The pictures stay on the clock, now as an unsaved set.
        this._settings.set_string('set-preset', '');
        this._reload();
        this._toast(`Moved “${loaded.name}” to the Trash`);
    }

    _openFolder() {
        GLib.mkdir_with_parents(this._dir, 0o755);
        new Gtk.FileLauncher({file: Gio.File.new_for_path(this._dir)})
            .launch(this._window, null, (launcher, result) => {
                try {
                    launcher.launch_finish(result);
                } catch (e) {
                    this._toast(`Couldn’t open the folder: ${e.message}`);
                }
            });
    }

    _showFile() {
        const loaded = this._loaded();
        if (!loaded)
            return;
        new Gtk.FileLauncher({file: Gio.File.new_for_path(loaded.path)})
            .open_containing_folder(this._window, null, (launcher, result) => {
                try {
                    launcher.open_containing_folder_finish(result);
                } catch (e) {
                    this._toast(`Couldn’t show the file: ${e.message}`);
                }
            });
    }

    /** For tests/prefs-window.js: open a preset by name, as if picked. */
    pick(name) {
        const index = this._items.findIndex(i => i.preset?.name === name);
        if (index >= 0)
            this._dropdown.set_selected(index);
    }

    _toast(title) {
        this._window.add_toast(new Adw.Toast({title: GLib.markup_escape_text(title, -1), timeout: 4}));
    }
}
