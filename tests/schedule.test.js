// SPDX-License-Identifier: GPL-2.0-or-later
import {test, assertEqual, assert} from './harness.js';
import {getPhase, getTodaysEvents, wallpaperForPhase, Phase} from '../src/lib/schedule.js';
import {getSunTimes} from '../src/lib/sun.js';

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
    // No twilight with set times: sunrise 07:00–08:00, sunset 19:00–20:00.
    assertEqual(getPhase(at(6, 59), fixedWithTransitions).phase, Phase.NIGHT);
    assertEqual(getPhase(at(7, 0), fixedWithTransitions).phase, Phase.SUNRISE);
    assertEqual(getPhase(at(8, 0), fixedWithTransitions).phase, Phase.DAY);
    assertEqual(getPhase(at(18, 59), fixedWithTransitions).phase, Phase.DAY);
    assertEqual(getPhase(at(19, 0), fixedWithTransitions).phase, Phase.SUNSET);
    assertEqual(getPhase(at(20, 0), fixedWithTransitions).phase, Phase.NIGHT);
});

test('sun mode: sunrise wallpaper from dawn, sunset one until dusk', () => {
    const london = {mode: 'sun', latitude: 51.5074, longitude: -0.1278, transitions: true, transitionMinutes: 60};
    const sun = getSunTimes(new Date('2026-12-21T12:00Z'), london.latitude, london.longitude);
    const phaseAt = (date, offsetMinutes) =>
        getPhase(new Date(date.getTime() + offsetMinutes * 60_000), london).phase;
    assertEqual(phaseAt(sun.dawn, -1), Phase.NIGHT);
    assertEqual(phaseAt(sun.dawn, 1), Phase.SUNRISE, 'sunrise wallpaper starts at dawn');
    assertEqual(phaseAt(sun.dawn, 59), Phase.SUNRISE);
    assertEqual(phaseAt(sun.dawn, 61), Phase.DAY, 'for 60 minutes');
    assertEqual(phaseAt(sun.dusk, -61), Phase.DAY);
    assertEqual(phaseAt(sun.dusk, -59), Phase.SUNSET, 'sunset wallpaper for the 60 minutes before dusk');
    assertEqual(phaseAt(sun.dusk, 1), Phase.NIGHT, 'night starts at dusk');
});

test('sun mode: without transitions, day is sunrise to sunset', () => {
    const london = {mode: 'sun', latitude: 51.5074, longitude: -0.1278, transitions: false, transitionMinutes: 60};
    const sun = getSunTimes(new Date('2026-12-21T12:00Z'), london.latitude, london.longitude);
    assertEqual(getPhase(new Date(sun.sunrise.getTime() - 60_000), london).phase, Phase.NIGHT);
    assertEqual(getPhase(new Date(sun.sunrise.getTime() + 60_000), london).phase, Phase.DAY);
});

test('sun mode: no dawn or dusk falls back to sunrise and sunset', () => {
    // Trondheim at midsummer: the sun sets but it never gets darker than twilight.
    const trondheim = {mode: 'sun', latitude: 63.4305, longitude: 10.3951, transitions: true, transitionMinutes: 60};
    const sun = getSunTimes(new Date('2026-06-21T12:00Z'), trondheim.latitude, trondheim.longitude);
    assertEqual(sun.dawn, null);
    assertEqual(getPhase(new Date(sun.sunrise.getTime() - 60_000), trondheim).phase, Phase.NIGHT);
    assertEqual(getPhase(new Date(sun.sunrise.getTime() + 60_000), trondheim).phase, Phase.SUNRISE);
    assertEqual(getPhase(new Date(sun.sunset.getTime() - 60_000), trondheim).phase, Phase.SUNSET);
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
    assertEqual(getPhase(at(11, 0), short).phase, Phase.NIGHT);
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
