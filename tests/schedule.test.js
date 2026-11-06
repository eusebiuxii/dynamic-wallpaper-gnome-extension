// SPDX-License-Identifier: GPL-2.0-or-later
import {test, assertEqual, assert} from './harness.js';
import {getPhase, getTodaysEvents, wallpaperForPhase, Phase} from '../src/lib/schedule.js';

// Local times on purpose: "fixed" mode is about the clock on the wall.
const at = (h, m = 0, dayOffset = 0) => new Date(2026, 5, 10 + dayOffset, h, m);

const fixed = {
    mode: 'fixed', dayStart: 7 * 60, nightStart: 20 * 60,
    transitions: false, transitionMinutes: 60,
};
const fixedWithTransitions = {...fixed, transitions: true};

test('fixed times: day and night', () => {
    assertEqual(getPhase(at(6, 59), fixed).phase, Phase.NIGHT);
    assertEqual(getPhase(at(7, 0), fixed).phase, Phase.DAY);
    assertEqual(getPhase(at(19, 59), fixed).phase, Phase.DAY);
    assertEqual(getPhase(at(20, 0), fixed).phase, Phase.NIGHT);
    assertEqual(getPhase(at(0, 30), fixed).phase, Phase.NIGHT);
});

test('fixed times: next change is reported', () => {
    const {nextChange} = getPhase(at(12), fixed);
    assertEqual(nextChange.getTime(), at(20).getTime());
    const late = getPhase(at(23), fixed);
    assertEqual(late.nextChange.getTime(), at(7, 0, 1).getTime(), 'after night starts, next is tomorrow 07:00');
});

test('fixed times: sunrise and sunset wallpapers', () => {
    assertEqual(getPhase(at(7, 30), fixedWithTransitions).phase, Phase.SUNRISE);
    assertEqual(getPhase(at(8, 0), fixedWithTransitions).phase, Phase.DAY);
    assertEqual(getPhase(at(18, 59), fixedWithTransitions).phase, Phase.DAY);
    assertEqual(getPhase(at(19, 0), fixedWithTransitions).phase, Phase.SUNSET, 'sunset shows in the hour before night');
    assertEqual(getPhase(at(20, 0), fixedWithTransitions).phase, Phase.NIGHT);
});

test('fixed times: night starting after midnight', () => {
    const owl = {...fixed, dayStart: 9 * 60, nightStart: 60}; // 09:00 to 01:00
    assertEqual(getPhase(at(0, 30), owl).phase, Phase.DAY, '00:30 is still the previous day');
    assertEqual(getPhase(at(1, 30), owl).phase, Phase.NIGHT);
    assertEqual(getPhase(at(9, 30), owl).phase, Phase.DAY);
});

test('short days split the time between sunrise and sunset', () => {
    const short = {...fixedWithTransitions, dayStart: 10 * 60, nightStart: 11 * 60, transitionMinutes: 60};
    assertEqual(getPhase(at(10, 15), short).phase, Phase.SUNRISE);
    assertEqual(getPhase(at(10, 45), short).phase, Phase.SUNSET);
    const {events} = getTodaysEvents(at(12), short);
    assert(!events.some(e => e.phase === Phase.DAY), 'no zero-length day phase');
});

test('sun mode: London in June has a night and a day', () => {
    const london = {mode: 'sun', latitude: 51.5074, longitude: -0.1278, transitions: false, transitionMinutes: 60};
    const noon = new Date('2026-06-21T12:00Z');
    const midnight = new Date('2026-06-21T23:30Z');
    assertEqual(getPhase(noon, london).phase, Phase.DAY);
    assertEqual(getPhase(midnight, london).phase, Phase.NIGHT);
});

test('sun mode: midnight sun stays on day', () => {
    const tromso = {mode: 'sun', latitude: 69.6492, longitude: 18.9553, transitions: true, transitionMinutes: 60};
    assertEqual(getPhase(new Date('2026-06-21T23:00Z'), tromso).phase, Phase.DAY);
});

test('missing sunrise/sunset wallpapers fall back to the day one', () => {
    const w = {day: 'file:///day.jpg', night: 'file:///night.jpg', sunrise: '', sunset: 'file:///sunset.jpg'};
    assertEqual(wallpaperForPhase(Phase.SUNRISE, w), w.day);
    assertEqual(wallpaperForPhase(Phase.SUNSET, w), w.sunset);
    assertEqual(wallpaperForPhase(Phase.NIGHT, w), w.night);
});
