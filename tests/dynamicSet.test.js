// SPDX-License-Identifier: GPL-2.0-or-later
import {test, assertEqual, assert} from './harness.js';
import {
    availableLabels, convertEntries, currentEntry, entryTimes, labelTimes,
    minutesOfDay, nearestLabel, parseEntries, placeOnLabel, planSetSlideshow, setEvents,
    spreadEvenly, SUN_LABELS,
} from '../src/lib/dynamicSet.js';
import {getSunAltitude, getSunTimes} from '../src/lib/sun.js';

const DAY = 24 * 60 * 60;
const total = plan => plan.slides.reduce((sum, s) => sum + s.seconds, 0);
const day = (month, date, h = 12, m = 0) => new Date(2026, month, date, h, m);

const MANCHESTER = {latitude: 53.48, longitude: -2.24};
const TROMSO = {latitude: 69.65, longitude: 18.96};
const TRONDHEIM = {latitude: 63.43, longitude: 10.40};

const timeSet = (...times) => ({
    mode: 'time', ...MANCHESTER,
    entries: times.map((time, i) => ({file: `/w/${i}.jpg`, time, label: 'midday'})),
});
const sunSet = (...labels) => ({
    mode: 'sun', ...MANCHESTER,
    entries: labels.map((label, i) => ({file: `/w/${i}.jpg`, time: 0, label})),
});

test('sun: noon is between sunrise and sunset, and the sun is highest then', () => {
    const sun = getSunTimes(day(10, 7), MANCHESTER.latitude, MANCHESTER.longitude);
    assert(sun.sunrise < sun.noon && sun.noon < sun.sunset, 'order');
    const {latitude, longitude} = MANCHESTER;
    const atNoon = getSunAltitude(sun.noon, latitude, longitude);
    assert(atNoon > getSunAltitude(new Date(sun.noon - 3600_000), latitude, longitude), 'higher than an hour before');
    assert(atNoon > getSunAltitude(new Date(sun.noon.getTime() + 3600_000), latitude, longitude), 'higher than an hour after');
    assert(Math.abs(getSunAltitude(sun.sunrise, latitude, longitude) + 0.833) < 0.3, 'about -0.8° at sunrise');
});

test('17 labels: 12 from dawn to dusk, 5 at night', () => {
    assertEqual(SUN_LABELS.length, 17);
    const ids = SUN_LABELS.map(l => l.id);
    assertEqual(ids.indexOf('dusk') - ids.indexOf('dawn') + 1, 12);
});

test('golden hour is when the sun drops below 6°, in summer', () => {
    const {latitude, longitude} = MANCHESTER;
    const t = labelTimes(day(5, 21), latitude, longitude);
    const altitude = getSunAltitude(t['golden-hour'], latitude, longitude);
    assert(Math.abs(altitude - 6) < 0.5, `altitude ${altitude}`);
});

test('labels happen in order through the day', () => {
    for (const month of [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]) {
        const t = labelTimes(day(month, 15), MANCHESTER.latitude, MANCHESTER.longitude);
        const times = SUN_LABELS.map(l => t[l.id]);
        assert(times.every(Boolean), `all labels happen in Manchester (month ${month + 1})`);
        for (let i = 1; i < times.length; i++)
            assert(times[i - 1] < times[i], `${SUN_LABELS[i - 1].id} before ${SUN_LABELS[i].id}`);
    }
});

test('far north in summer: no dawn, dusk or night; midnight sun: only midday and midnight', () => {
    const june = day(5, 21);
    const trondheim = availableLabels(june, TRONDHEIM.latitude, TRONDHEIM.longitude).map(l => l.id);
    assertEqual(trondheim.join(), 'sunrise,early-morning,morning,late-morning,midday,' +
        'early-afternoon,afternoon,late-afternoon,golden-hour,sunset,midnight');
    const tromso = availableLabels(june, TROMSO.latitude, TROMSO.longitude).map(l => l.id);
    assertEqual(tromso.join(), 'midday,midnight');
});

test('time mode: pictures start at their times', () => {
    const times = entryTimes(day(10, 7), timeSet(6 * 60, 18 * 60 + 30));
    assertEqual(times[0].getTime(), day(10, 7, 6).getTime());
    assertEqual(times[1].getTime(), day(10, 7, 18, 30).getTime());
});

test('sun mode: pictures sharing a label are spread up to the next label', () => {
    const set = sunSet('sunset', 'sunset', 'dusk');
    const t = labelTimes(day(10, 7), MANCHESTER.latitude, MANCHESTER.longitude);
    const times = entryTimes(day(10, 7), set);
    assertEqual(times[0].getTime(), t.sunset.getTime());
    assertEqual(times[1].getTime(), (t.sunset.getTime() + t.dusk.getTime()) / 2);
    assertEqual(times[2].getTime(), t.dusk.getTime());
});

test('sun mode: a picture can sit minutes before or after a label', () => {
    const set = sunSet('sunset', 'sunset', 'dusk');
    set.entries[1].offset = 20;
    set.entries[2].offset = -10;
    const t = labelTimes(day(10, 7), MANCHESTER.latitude, MANCHESTER.longitude);
    const times = entryTimes(day(10, 7), set);
    assertEqual(times[0].getTime(), t.sunset.getTime(), 'alone on the label now, so not spread');
    assertEqual(times[1].getTime(), t.sunset.getTime() + 20 * 60_000);
    assertEqual(times[2].getTime(), t.dusk.getTime() - 10 * 60_000);
});

test('placing a time on the sun: snaps near a label, otherwise label ± minutes', () => {
    const {latitude, longitude} = MANCHESTER;
    const sunset = minutesOfDay(labelTimes(day(10, 7), latitude, longitude).sunset);
    const near = placeOnLabel(sunset + 8, day(10, 7), latitude, longitude, 10);
    assertEqual(`${near.label} ${near.offset}`, 'sunset 0');
    const after = placeOnLabel(sunset + 14, day(10, 7), latitude, longitude, 10);
    assertEqual(`${after.label} ${after.offset}`, 'sunset 14');
    const before = placeOnLabel(sunset - 15, day(10, 7), latitude, longitude, 10);
    assertEqual(`${before.label} ${before.offset}`, 'sunset -15');
});

test('sun mode: a label that doesn\'t happen leaves its picture out', () => {
    const set = {...sunSet('dusk', 'midday'), ...TROMSO};
    const times = entryTimes(day(5, 21), set);
    assertEqual(times[0], null);
    assert(times[1] instanceof Date);
});

test('sun mode: pictures move with the seasons', () => {
    const set = sunSet('sunrise');
    const winter = minutesOfDay(entryTimes(day(11, 21), set)[0]);
    const summer = minutesOfDay(entryTimes(day(5, 21), set)[0]);
    assert(winter - summer > 3 * 60, `winter sunrise ${winter} vs summer ${summer}`);
});

test('the set slideshow adds up to 24 hours and shows the right picture', () => {
    for (const set of [timeSet(0, 360, 720, 1080), sunSet(...SUN_LABELS.map(l => l.id))]) {
        const now = day(10, 7, 9, 17);
        const plan = planSetSlideshow(now, set, 0);
        assertEqual(total(plan), DAY, `${set.mode}: total`);
        assertEqual(plan.slides.length, set.entries.length, `${set.mode}: one slide each`);
        let t = plan.start.getTime() / 1000;
        const ends = plan.slides.map(s => (t += s.seconds));
        for (let m = 1; m < 24 * 60 - 15; m += 11) {
            const when = new Date(plan.start.getTime() + m * 60_000);
            const i = ends.findIndex(end => when.getTime() / 1000 < end);
            assertEqual(plan.slides[i].file, set.entries[currentEntry(when, set)].file,
                `${set.mode} at ${when}`);
        }
    }
});

test('the set slideshow fades into every picture, 16 pictures', () => {
    const times = Array.from({length: 16}, (_, i) => i * 90);
    const plan = planSetSlideshow(day(10, 7, 13), timeSet(...times), 15 * 60);
    assertEqual(plan.slides.length, 16);
    assert(plan.slides.every(s => s.fade === 15 * 60), 'every picture fades in');
    assertEqual(total(plan), DAY);
});

test('one picture, or none', () => {
    const plan = planSetSlideshow(day(10, 7), timeSet(600), 900);
    assertEqual(plan.slides.length, 1);
    assertEqual(plan.slides[0].fade, 0);
    assertEqual(planSetSlideshow(day(10, 7), timeSet(), 900), null);
});

test('the same image used twice still changes at both times', () => {
    const set = timeSet(8 * 60, 12 * 60, 20 * 60);
    set.entries[2].file = set.entries[0].file;
    const plan = planSetSlideshow(day(10, 7, 9), set, 0);
    assertEqual(plan.slides.map(s => s.file).join(), '/w/0.jpg,/w/1.jpg,/w/0.jpg');
    assertEqual(plan.slides.map(s => s.seconds / 3600).join(), '4,8,12');
});

test('events cover two days either side', () => {
    const events = setEvents(day(10, 7), timeSet(60, 600));
    assertEqual(events.length, 10);
    assert(events.every((e, i) => i === 0 || events[i - 1].time <= e.time), 'sorted');
});

test('nearest label and switching modes', () => {
    const t = labelTimes(day(10, 7), MANCHESTER.latitude, MANCHESTER.longitude);
    assertEqual(nearestLabel(minutesOfDay(t.sunset) + 3, day(10, 7), MANCHESTER.latitude, MANCHESTER.longitude), 'sunset');
    assertEqual(nearestLabel(12 * 60, day(10, 7), MANCHESTER.latitude, MANCHESTER.longitude), 'midday');

    const toTime = convertEntries(sunSet('sunrise', 'sunset').entries, 'time', day(10, 7),
        MANCHESTER.latitude, MANCHESTER.longitude);
    assertEqual(toTime[0].time, minutesOfDay(t.sunrise));
    assertEqual(toTime[1].time, minutesOfDay(t.sunset));
    const back = convertEntries(toTime, 'sun', day(10, 7), MANCHESTER.latitude, MANCHESTER.longitude);
    assertEqual(back.map(e => e.label).join(), 'sunrise,sunset');
});

test('spread evenly keeps the order and starts at the earliest', () => {
    const spread = spreadEvenly(timeSet(600, 300, 610, 620).entries);
    assertEqual(spread.map(e => e.time).join(), `${300 + 360},300,${300 + 720},${300 + 1080}`);
});

test('stored entries are checked', () => {
    assertEqual(parseEntries('not json').length, 0);
    assertEqual(parseEntries('{}').length, 0);
    const list = parseEntries(JSON.stringify([
        {uri: 'file:///a.jpg', time: 1500, label: 'dusk'},
        {uri: '', time: 10},
        {uri: 'file:///b.jpg', label: 'nonsense', offset: 99999},
        {uri: 'file:///c.jpg', label: 'early-day'},
    ]));
    assertEqual(list.length, 3);
    assertEqual(list[2].label, 'morning', 'old label names still work');
    assertEqual(list[0].time, 60);
    assertEqual(list[1].label, 'midday');
    assertEqual(list[1].time, 0);
    assertEqual(list[0].offset, 0);
    assertEqual(list[1].offset, 720);
});
