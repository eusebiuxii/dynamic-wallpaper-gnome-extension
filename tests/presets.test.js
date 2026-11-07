// SPDX-License-Identifier: GPL-2.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {test, assertEqual, assert} from './harness.js';
import {
    fileNameFor, freeName, fromStoredPath, importPreset, listPresets, parsePreset, pathFor,
    readPreset, renamePreset, samePreset, serializePreset, toStoredPath, trashPreset, writePreset,
} from '../src/lib/presets.js';

const HOME = '/home/someone';
const uri = path => Gio.File.new_for_path(path).get_uri();

const sunPreset = () => ({
    name: 'Big Sur',
    mode: 'sun',
    fadeMinutes: 20,
    folder: uri(`${HOME}/Pictures/Big Sur`),
    entries: [
        {uri: uri(`${HOME}/Pictures/Big Sur/dawn.jpg`), time: 400, label: 'dawn', offset: 0},
        {uri: uri(`${HOME}/Pictures/Big Sur/dusk 2.jpg`), time: 1000, label: 'sunset', offset: 20},
        {uri: uri('/usr/share/backgrounds/night.jpg'), time: 1300, label: 'night', offset: -5},
    ],
});
const timePreset = () => ({
    name: 'Clock',
    mode: 'time',
    fadeMinutes: 0,
    folder: '',
    entries: [
        {uri: uri(`${HOME}/a.png`), time: 450, label: 'midday', offset: 0},
        {uri: uri(`${HOME}/b.png`), time: 1335, label: 'midday', offset: 0},
    ],
});

test('paths in the home folder are written with ~, others in full', () => {
    assertEqual(toStoredPath(uri(`${HOME}/Pictures/a b.jpg`), HOME), '~/Pictures/a b.jpg');
    assertEqual(toStoredPath(uri('/usr/share/x.jpg'), HOME), '/usr/share/x.jpg');
    assertEqual(toStoredPath(uri(`${HOME}2/x.jpg`), HOME), `${HOME}2/x.jpg`, 'only inside home');
    assertEqual(toStoredPath('', HOME), '');
});

test('stored paths come back as URIs: ~, absolute, relative to the preset', () => {
    assertEqual(fromStoredPath('~/Pictures/a b.jpg', '/x', HOME), uri(`${HOME}/Pictures/a b.jpg`));
    assertEqual(fromStoredPath('/usr/share/x.jpg', '/x', HOME), uri('/usr/share/x.jpg'));
    assertEqual(fromStoredPath('pics/x.jpg', '/shared/set', HOME), uri('/shared/set/pics/x.jpg'));
    assertEqual(fromStoredPath('file:///tmp/x.jpg', '/x', HOME), 'file:///tmp/x.jpg');
});

test('sun preset: written with labels and offsets, read back the same', () => {
    const text = serializePreset(sunPreset(), HOME);
    const data = JSON.parse(text);
    assertEqual(data.format, 1);
    assertEqual(data.mode, 'sun');
    assertEqual(data.folder, '~/Pictures/Big Sur');
    assertEqual(data.pictures[0].file, '~/Pictures/Big Sur/dawn.jpg');
    assertEqual(data.pictures[0].offset, undefined, 'no offset when on the label');
    assertEqual(data.pictures[1].offset, 20);
    assertEqual(data.pictures[0].time, undefined, 'no clock time in sun mode');
    const back = parsePreset(text, '/x', '', HOME);
    assertEqual(back.name, 'Big Sur');
    assertEqual(back.fadeMinutes, 20);
    assert(samePreset(back, sunPreset()), 'round trip');
});

test('time preset: written as HH:MM, read back the same', () => {
    const text = serializePreset(timePreset(), HOME);
    const data = JSON.parse(text);
    assertEqual(data.pictures[0].time, '07:30');
    assertEqual(data.pictures[1].time, '22:15');
    assertEqual(data.pictures[0].label, undefined);
    assertEqual(data.folder, '');
    const back = parsePreset(text, '/x', '', HOME);
    assertEqual(back.entries[1].time, 1335);
    assertEqual(back.folder, '');
    assert(samePreset(back, timePreset()), 'round trip');
});

test('samePreset ignores what the file doesn\'t store', () => {
    const moved = sunPreset();
    moved.entries[0].time = 123; // clock time in sun mode
    assert(samePreset(moved, sunPreset()), 'sun mode clock time');
    const relabelled = timePreset();
    relabelled.entries[0].label = 'dawn';
    assert(samePreset(relabelled, timePreset()), 'time mode label');
    const renamed = {...sunPreset(), name: 'Other'};
    assert(samePreset(renamed, sunPreset()), 'name');
    const changed = sunPreset();
    changed.entries[1].offset = 25;
    assert(!samePreset(changed, sunPreset()), 'offset matters');
    assert(!samePreset({...sunPreset(), fadeMinutes: 5}, sunPreset()), 'fade matters');
});

test('bad pictures are dropped, bad files rejected', () => {
    const text = JSON.stringify({
        mode: 'time',
        pictures: [
            {file: 'a.jpg', time: '25:00'},
            {file: 'b.jpg', time: '7:05'},
            {time: '08:00'},
            {file: 'c.jpg', time: 90},
            null,
        ],
    });
    const preset = parsePreset(text, '/p', 'From file', HOME);
    assertEqual(preset.entries.length, 2);
    assertEqual(preset.entries[0].time, 425);
    assertEqual(preset.entries[1].time, 90);
    assertEqual(preset.name, 'From file', 'falls back to the file name');
    assertEqual(preset.fadeMinutes, 15, 'default fade');

    const sun = parsePreset(JSON.stringify({pictures: [{file: 'a', label: 'teatime'}, {file: 'b', label: 'dusk', offset: 9999}]}), '/p');
    assertEqual(sun.mode, 'sun', 'sun by default');
    assertEqual(sun.entries.length, 1);
    assertEqual(sun.entries[0].offset, 720, 'offset clamped');

    for (const bad of ['not json', '[]', '{"name": "x"}', '{"format": 99, "pictures": []}']) {
        let threw = false;
        try {
            parsePreset(bad, '/p');
        } catch {
            threw = true;
        }
        assert(threw, `rejects ${bad}`);
    }
});

test('file names: unsafe characters replaced', () => {
    assertEqual(fileNameFor('Big Sur'), 'Big Sur.json');
    assertEqual(fileNameFor('a/b\\c'), 'a-b-c.json');
    assertEqual(fileNameFor('..hidden'), 'hidden.json');
    assertEqual(fileNameFor('  '), 'Preset.json');
});

test('files: write, list, rename, import, free names, trash', () => {
    const dir = GLib.dir_make_tmp('dw-presets-XXXXXX');
    const presets = GLib.build_filenamev([dir, 'presets']);
    try {
        assertEqual(listPresets(presets).length, 0, 'no folder yet');

        writePreset(pathFor('Zebra', presets), {...timePreset(), name: 'Zebra'});
        writePreset(pathFor('apple', presets), {...sunPreset(), name: 'apple'});
        GLib.file_set_contents(GLib.build_filenamev([presets, 'broken.json']), 'nope');
        GLib.file_set_contents(GLib.build_filenamev([presets, 'notes.txt']), 'ignored');

        let list = listPresets(presets);
        assertEqual(list.map(p => p.name).join(), 'apple,broken,Zebra');
        assert(list[1].error && !list[1].preset, 'broken file listed with an error');
        assert(samePreset(list[0].preset, sunPreset()), 'read back');

        assertEqual(freeName('Zebra', presets), 'Zebra 2');
        assertEqual(freeName('Lion', presets), 'Lion');

        const renamed = renamePreset(pathFor('Zebra', presets), 'Yak');
        assertEqual(renamed, pathFor('Yak', presets));
        assert(!GLib.file_test(pathFor('Zebra', presets), GLib.FileTest.EXISTS), 'old file gone');
        assertEqual(readPreset(renamed).name, 'Yak');

        // A shared preset with paths relative to itself.
        const shared = GLib.build_filenamev([dir, 'shared']);
        GLib.mkdir_with_parents(shared, 0o755);
        const source = GLib.build_filenamev([shared, 'Mine.json']);
        GLib.file_set_contents(source, JSON.stringify({
            name: 'apple', mode: 'time', pictures: [{file: 'pics/a.jpg', time: '06:00'}],
        }));
        const imported = importPreset(source, presets);
        const preset = readPreset(imported);
        assertEqual(preset.name, 'apple 2', 'doesn\'t replace an existing preset');
        assertEqual(preset.entries[0].uri, uri(`${shared}/pics/a.jpg`), 'relative path resolved');

        trashPreset(GLib.build_filenamev([presets, 'broken.json']), false);
        list = listPresets(presets);
        assertEqual(list.map(p => p.name).join(), 'apple,apple 2,Yak');
    } finally {
        GLib.spawn_command_line_sync(`rm -rf ${GLib.shell_quote(dir)}`);
    }
});
