// SPDX-License-Identifier: GPL-2.0-or-later
// Presets: a dynamic set saved to a file, so you can keep several and switch
// between them on the Dynamic set tab.
//
// Presets live in ~/.local/share/dynamic-wallpaper/presets/, one JSON file
// each:
//
//   {
//     "format": 1,
//     "name": "Big Sur",
//     "mode": "sun",
//     "fadeMinutes": 15,
//     "folder": "~/Pictures/Backgrounds/Big Sur",
//     "pictures": [
//       {"file": "~/Pictures/Backgrounds/Big Sur/dawn.jpg", "label": "dawn"},
//       {"file": "~/Pictures/Backgrounds/Big Sur/dusk.jpg", "label": "sunset", "offset": 20}
//     ]
//   }
//
// In time mode a picture has "time": "07:30" instead of a label. Pictures in
// your home folder are written as ~/..., so a file holds no user name and
// still works for another account with the same folders. A path with no / or
// ~ at the start is relative to the preset file's own folder, for presets
// shared alongside their pictures.
//
// Opening a preset copies it into the settings; the extension itself never
// reads these files. Uses Gio/GLib only (no GNOME Shell or GTK), so it can be
// tested with `gjs`.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {MAX_OFFSET, SUN_LABELS} from './dynamicSet.js';

export const FORMAT = 1;
export const SUFFIX = '.json';
const DAY_MINUTES = 24 * 60;
const MAX_FADE = 120;

/** ~/.local/share/dynamic-wallpaper/presets */
export function presetsDir() {
    return GLib.build_filenamev([GLib.get_user_data_dir(), 'dynamic-wallpaper', 'presets']);
}

// ------------------------------------------------------------------ Paths

/** A file URI as written in a preset: ~/... inside `home`, else the full path. */
export function toStoredPath(uri, home = GLib.get_home_dir()) {
    if (!uri)
        return '';
    const path = Gio.File.new_for_uri(uri).get_path();
    if (!path)
        return uri; // not a local file: keep the URI
    return path.startsWith(`${home}/`) ? `~/${path.slice(home.length + 1)}` : path;
}

/**
 * A path from a preset back to a file URI. Relative paths are taken from
 * `baseDir` (the preset file's folder).
 */
export function fromStoredPath(text, baseDir, home = GLib.get_home_dir()) {
    if (!text)
        return '';
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text))
        return text;
    let path;
    if (text === '~' || text.startsWith('~/'))
        path = home + text.slice(1);
    else if (GLib.path_is_absolute(text))
        path = text;
    else
        path = GLib.build_filenamev([baseDir, text]);
    return Gio.File.new_for_path(path).get_uri();
}

// ------------------------------------------------------------------ Format

const pad = n => String(n).padStart(2, '0');
const formatTime = m => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

/** "07:30" or a number of minutes → minutes after midnight, or null. */
function parseTime(value) {
    if (Number.isFinite(value))
        return ((Math.round(value) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
    const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim());
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59)
        return null;
    return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * A set as a preset file's text.
 *
 * @param {{name: string, mode: string, fadeMinutes: number, folder: string,
 *          entries: {uri: string, time: number, label: string, offset: number}[]}} preset
 *        `folder` and each `uri` are file URIs ('' for no folder)
 */
export function serializePreset(preset, home = GLib.get_home_dir()) {
    const sun = preset.mode === 'sun';
    const data = {
        format: FORMAT,
        name: preset.name,
        mode: sun ? 'sun' : 'time',
        fadeMinutes: preset.fadeMinutes,
        folder: toStoredPath(preset.folder, home),
        pictures: preset.entries.map(entry => {
            const picture = {file: toStoredPath(entry.uri, home)};
            if (sun) {
                picture.label = entry.label;
                if (entry.offset)
                    picture.offset = entry.offset;
            } else {
                picture.time = formatTime(entry.time);
            }
            return picture;
        }),
    };
    return `${JSON.stringify(data, null, 2)}\n`;
}

/**
 * Reads a preset file's text. Unknown labels, bad times and the like are
 * dropped or fixed up rather than failing the whole file.
 *
 * @param {string} text
 * @param {string} baseDir the file's folder, for relative picture paths
 * @param {string} fallbackName used when the file has no name
 * @returns the preset (as serializePreset takes it); in sun mode each
 *          picture's `time` is 0 and in time mode its label is 'midday'
 * @throws {Error} with a message for people when it isn't a preset at all
 */
export function parsePreset(text, baseDir, fallbackName = '', home = GLib.get_home_dir()) {
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        throw new Error('This isn’t a preset file (it isn’t valid JSON).');
    }
    if (!data || typeof data !== 'object' || !Array.isArray(data.pictures))
        throw new Error('This isn’t a preset file (it has no list of pictures).');
    if (Number.isFinite(data.format) && data.format > FORMAT)
        throw new Error('This preset was saved by a newer version of the extension.');

    const sun = data.mode !== 'time';
    const labels = new Set(SUN_LABELS.map(l => l.id));
    const entries = [];
    for (const picture of data.pictures) {
        if (!picture || typeof picture.file !== 'string' || !picture.file)
            continue;
        const uri = fromStoredPath(picture.file, baseDir, home);
        if (sun) {
            if (!labels.has(picture.label))
                continue;
            const offset = Number.isFinite(picture.offset)
                ? Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, Math.round(picture.offset))) : 0;
            entries.push({uri, time: 0, label: picture.label, offset});
        } else {
            const time = parseTime(picture.time);
            if (time === null)
                continue;
            entries.push({uri, time, label: 'midday', offset: 0});
        }
    }

    const fade = Number.isFinite(data.fadeMinutes)
        ? Math.max(0, Math.min(MAX_FADE, Math.round(data.fadeMinutes))) : 15;
    return {
        name: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : fallbackName,
        mode: sun ? 'sun' : 'time',
        fadeMinutes: fade,
        folder: typeof data.folder === 'string' ? fromStoredPath(data.folder, baseDir, home) : '',
        entries,
    };
}

/**
 * Whether two sets are the same as far as a preset is concerned (the name
 * aside). Only what the file stores counts, so in sun mode a picture's clock
 * time doesn't matter, and in time mode its label doesn't.
 */
export function samePreset(a, b) {
    const key = p => serializePreset({...p, name: ''}, '/');
    return key(a) === key(b);
}

// ------------------------------------------------------------------ Files

/** A file name for a preset name: "Big Sur" → "Big Sur.json". */
export function fileNameFor(name) {
    const safe = name
        .replace(/[/\\\0-\x1f]/g, '-')
        .replace(/^\.+/, '')
        .trim()
        .slice(0, 100);
    return `${safe || 'Preset'}${SUFFIX}`;
}

const decoder = new TextDecoder();

function readText(path) {
    const [, bytes] = Gio.File.new_for_path(path).load_contents(null);
    return decoder.decode(bytes);
}

/** Reads a preset file. @throws {Error} (GLib or parsePreset's) */
export function readPreset(path) {
    const name = GLib.path_get_basename(path).replace(/\.json$/i, '');
    return parsePreset(readText(path), GLib.path_get_dirname(path), name);
}

/** Writes a preset file (all at once, so a crash can't leave half a file). */
export function writePreset(path, preset) {
    GLib.mkdir_with_parents(GLib.path_get_dirname(path), 0o755);
    const bytes = new TextEncoder().encode(serializePreset(preset));
    Gio.File.new_for_path(path).replace_contents(bytes, null, false,
        Gio.FileCreateFlags.REPLACE_DESTINATION, null);
}

/**
 * The presets in `dir`, sorted by name. Files that can't be read are listed
 * with `error` set, so they can still be found and deleted.
 *
 * @returns {{name: string, path: string, preset: object|null, error: string|null}[]}
 */
export function listPresets(dir = presetsDir()) {
    const found = [];
    let children;
    try {
        children = Gio.File.new_for_path(dir).enumerate_children(
            'standard::name,standard::type,standard::is-hidden', Gio.FileQueryInfoFlags.NONE, null);
    } catch {
        return []; // no folder yet
    }
    let info;
    while ((info = children.next_file(null))) {
        const fileName = info.get_name();
        if (info.get_is_hidden() || info.get_file_type() !== Gio.FileType.REGULAR ||
            !fileName.toLowerCase().endsWith(SUFFIX))
            continue;
        const path = GLib.build_filenamev([dir, fileName]);
        try {
            const preset = readPreset(path);
            found.push({name: preset.name, path, preset, error: null});
        } catch (e) {
            found.push({name: fileName.slice(0, -SUFFIX.length), path, preset: null, error: e.message});
        }
    }
    children.close(null);
    return found.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, {numeric: true, sensitivity: 'base'}) ||
        a.path.localeCompare(b.path));
}

/** The path a preset called `name` would be saved at in `dir`. */
export function pathFor(name, dir = presetsDir()) {
    return GLib.build_filenamev([dir, fileNameFor(name)]);
}

/** A name not used by any preset in `dir`: "Big Sur", "Big Sur 2", ... */
export function freeName(name, dir = presetsDir()) {
    const taken = path => GLib.file_test(path, GLib.FileTest.EXISTS);
    if (!taken(pathFor(name, dir)))
        return name;
    for (let n = 2; ; n++) {
        if (!taken(pathFor(`${name} ${n}`, dir)))
            return `${name} ${n}`;
    }
}

/**
 * Copies a preset from anywhere into `dir` (under a free name), turning its
 * relative picture paths into ~/ or full ones.
 *
 * @returns {string} the new file's path
 */
export function importPreset(sourcePath, dir = presetsDir()) {
    const preset = readPreset(sourcePath);
    preset.name = freeName(preset.name, dir);
    const path = pathFor(preset.name, dir);
    writePreset(path, preset);
    return path;
}

/**
 * Renames a preset: the name inside the file and the file's name.
 *
 * @returns {string} the new path
 */
export function renamePreset(path, newName) {
    const preset = readPreset(path);
    preset.name = newName;
    const newPath = pathFor(newName, GLib.path_get_dirname(path));
    writePreset(newPath, preset);
    if (newPath !== path)
        Gio.File.new_for_path(path).delete(null);
    return newPath;
}

/**
 * Moves a preset to the Trash (or deletes it where there's no Trash).
 * `useTrash` false deletes it outright (for the tests).
 */
export function trashPreset(path, useTrash = true) {
    const file = Gio.File.new_for_path(path);
    if (!useTrash) {
        file.delete(null);
        return;
    }
    try {
        file.trash(null);
    } catch (e) {
        if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_SUPPORTED))
            throw e;
        file.delete(null);
    }
}
