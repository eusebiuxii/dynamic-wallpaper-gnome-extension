// SPDX-License-Identifier: GPL-2.0-or-later
import {test, assertEqual, assert} from './harness.js';
import {getCycle, getPhase, Phase} from '../src/lib/schedule.js';
import {planSlideshow, slideshowXml} from '../src/lib/slideshow.js';

const at = (h, m = 0, dayOffset = 0) => new Date(2026, 5, 10 + dayOffset, h, m);
const DAY = 24 * 60 * 60;
const total = plan => plan.slides.reduce((sum, s) => sum + s.seconds, 0);

const fixed = {
    mode: 'fixed', dayStart: 7 * 60, nightStart: 20 * 60,
    transitions: false, transitionMinutes: 60,
};
const fixedWithTransitions = {...fixed, transitions: true};
const london = {
    mode: 'sun', latitude: 51.5074, longitude: -0.1278,
    transitions: true, transitionMinutes: 60,
};
const files = {day: '/w/day.jpg', night: '/w/night.jpg', sunrise: '/w/rise.jpg', sunset: '/w/set.jpg'};

test('cycle starts at the last change and covers 24 hours', () => {
    const {start, segments} = getCycle(at(12), fixed);
    assertEqual(start.getTime(), at(7).getTime());
    assertEqual(segments.map(s => s.phase).join(), 'day,night');
    assertEqual(segments[0].end.getTime(), at(20).getTime());
    assertEqual(segments[1].end.getTime(), at(7, 0, 1).getTime());
});

test('cycle just after midnight starts at last night', () => {
    const {start, segments} = getCycle(at(0, 30), fixed);
    assertEqual(start.getTime(), at(20, 0, -1).getTime());
    assertEqual(segments[0].phase, Phase.NIGHT);
});

test('slideshow adds up to exactly 24 hours, with fades', () => {
    const plan = planSlideshow(at(12), fixedWithTransitions, files, 15 * 60);
    assertEqual(total(plan), DAY);
    assertEqual(plan.slides.map(s => s.file).join(),
        '/w/day.jpg,/w/set.jpg,/w/night.jpg,/w/rise.jpg');
    assert(plan.slides.every(s => s.fade === 15 * 60), 'every change fades for 15 minutes');
});

test('the slideshow shows what getPhase says, at every minute of the day', () => {
    // Fades start at each change, so with no fade the picture must match.
    for (const config of [fixed, fixedWithTransitions, london]) {
        const now = at(9, 17);
        const plan = planSlideshow(now, config, files, 0);
        let t = plan.start.getTime() / 1000;
        const ends = plan.slides.map(s => (t += s.seconds));
        const phaseFile = {night: files.night, sunrise: files.sunrise, day: files.day, sunset: files.sunset};
        // The file starts on a whole second, a moment before the exact
        // change, so start a minute in. Skip the last 15 minutes: tomorrow's sunrise is a minute or two
        // off today's, and the extension writes a new file before then.
        for (let m = 1; m < 24 * 60 - 15; m += 7) {
            const when = new Date(plan.start.getTime() + m * 60_000);
            const secs = when.getTime() / 1000;
            const i = ends.findIndex(end => secs < end);
            assertEqual(plan.slides[i].file, phaseFile[getPhase(when, config).phase],
                `${config.mode} at ${when}`);
        }
    }
});

test('days getting shorter: every change still fades', () => {
    // In November tomorrow's sunset is earlier than today's, so 24 hours
    // after today's sunset it's already sunset again. That mustn't become a
    // few minutes of sunset at the end of the cycle (which would leave the
    // first change without a fade).
    for (const hour of [6, 8, 12, 16, 22]) {
        const now = new Date(2026, 10, 7, hour, 30);
        const plan = planSlideshow(now, london, files, 15 * 60);
        assertEqual(plan.slides.length, 4, `at ${hour}:30`);
        assert(plan.slides.every(s => s.fade === 15 * 60), `every change fades, at ${hour}:30`);
        assertEqual(total(plan), DAY);
    }
});

test('a fade is never longer than the picture it fades into', () => {
    const plan = planSlideshow(at(12), fixedWithTransitions, files, 120 * 60);
    const rise = plan.slides.find(s => s.file === '/w/rise.jpg');
    assertEqual(rise.fade, 60 * 60);
});

test('pictures that repeat are merged and not faded', () => {
    const plan = planSlideshow(at(12), fixedWithTransitions, {...files, sunrise: '', sunset: ''}, 600);
    // The cycle starts at 08:00 (day) and ends with 07:00-08:00 (sunrise,
    // shown with the day picture): the same picture, so no fade between.
    assertEqual(plan.slides.map(s => s.file).join(), '/w/day.jpg,/w/night.jpg,/w/day.jpg');
    assertEqual(plan.slides.map(s => s.fade).join(), '0,600,600');
    assertEqual(total(plan), DAY);
});

test('only a day picture: shows it all day, no fades', () => {
    const plan = planSlideshow(at(12), fixed, {day: '/w/day.jpg', night: '', sunrise: '', sunset: ''}, 600);
    assertEqual(plan.slides.length, 1);
    assertEqual(plan.slides[0].fade, 0);
    assertEqual(planSlideshow(at(12), fixed, {day: '', night: '', sunrise: '', sunset: ''}, 600), null);
});

test('midnight sun: one picture all day', () => {
    const tromso = {mode: 'sun', latitude: 69.65, longitude: 18.96, transitions: true, transitionMinutes: 60};
    const plan = planSlideshow(at(12), tromso, files, 600);
    assertEqual(plan.slides.length, 1);
    assertEqual(plan.slides[0].file, '/w/day.jpg');
    assertEqual(plan.slides[0].seconds, DAY);
});

test('XML: start time, fades and escaping', () => {
    const plan = planSlideshow(at(12), fixed, {...files, night: '/w/night & <dark>.jpg'}, 900);
    const xml = slideshowXml(plan);
    assert(xml.includes('<year>2026</year>') && xml.includes('<month>6</month>') &&
        xml.includes('<day>10</day>') && xml.includes('<hour>7</hour>'), 'start time');
    assert(xml.includes('<transition type="overlay">'), 'has a fade');
    assert(xml.includes('/w/night &amp; &lt;dark&gt;.jpg'), 'escapes the file name');
    assert(!xml.includes('<dark>'), 'no raw < in file names');
    const durations = [...xml.matchAll(/<duration>(\d+)<\/duration>/g)].map(m => Number(m[1]));
    assertEqual(durations.reduce((a, b) => a + b, 0), DAY, 'durations add up to a day');
});
