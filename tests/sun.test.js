// SPDX-License-Identifier: GPL-2.0-or-later
import {test, assert, assertEqual, assertNear} from './harness.js';
import {getSunTimes} from '../src/lib/sun.js';

// Reference times from published almanacs, given in UTC so the tests pass in
// any time zone. A couple of minutes' tolerance covers rounding.
const cases = [
    ['London, midsummer', 51.5074, -0.1278, '2026-06-21T12:00Z', '2026-06-21T03:43Z', '2026-06-21T20:21Z'],
    ['London, midwinter', 51.5074, -0.1278, '2026-12-21T12:00Z', '2026-12-21T08:04Z', '2026-12-21T15:53Z'],
    ['New York, midsummer', 40.7128, -74.006, '2026-06-21T12:00Z', '2026-06-21T09:25Z', '2026-06-22T00:31Z'],
    ['Tokyo, midsummer', 35.6762, 139.6503, '2026-06-21T03:00Z', '2026-06-20T19:25Z', '2026-06-21T10:00Z'],
];

for (const [name, lat, lon, day, rise, set] of cases) {
    test(`${name}`, () => {
        const r = getSunTimes(new Date(day), lat, lon);
        assertNear(r.sunrise, new Date(rise), 3, 'sunrise');
        assertNear(r.sunset, new Date(set), 3, 'sunset');
    });
}

test('London midwinter: dawn and dusk are 35–45 minutes from sunrise and sunset', () => {
    const r = getSunTimes(new Date('2026-12-21T12:00Z'), 51.5074, -0.1278);
    const before = (r.sunrise - r.dawn) / 60_000;
    const after = (r.dusk - r.sunset) / 60_000;
    assert(before > 35 && before < 45, `dawn ${before} min before sunrise`);
    assert(after > 35 && after < 45, `dusk ${after} min after sunset`);
});

test('Trondheim midsummer: sun sets but no civil dawn or dusk', () => {
    const r = getSunTimes(new Date('2026-06-21T12:00Z'), 63.4305, 10.3951);
    assertEqual(r.polar, null);
    assertEqual(r.dawn, null);
    assertEqual(r.dusk, null);
});

test('midnight sun in Tromsø in June', () => {
    const r = getSunTimes(new Date('2026-06-21T12:00Z'), 69.6492, 18.9553);
    assertEqual(r.polar, 'day');
    assertEqual(r.sunrise, null);
});

test('polar night in Tromsø in December', () => {
    const r = getSunTimes(new Date('2026-12-21T12:00Z'), 69.6492, 18.9553);
    assertEqual(r.polar, 'night');
});
