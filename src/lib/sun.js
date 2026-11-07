// SPDX-License-Identifier: GPL-2.0-or-later
// Sunrise and sunset times, worked out from a latitude and longitude.
//
// This file has no GNOME imports on purpose: it's plain JavaScript, so the
// tests in ../../tests can run it directly with `gjs`, outside GNOME Shell.
//
// The maths is the "sunrise equation" (the same approach NOAA's solar
// calculator uses), accurate to within a minute or two, which is plenty for
// changing a wallpaper. See https://en.wikipedia.org/wiki/Sunrise_equation

const MS_PER_DAY = 86_400_000;
const JULIAN_UNIX_EPOCH = 2_440_587.5; // Julian date of 1970-01-01 00:00 UTC
const J2000 = 2_451_545.0; // Julian date of 2000-01-01 12:00 UTC

// The sun counts as "risen" when its top edge clears the horizon. That's
// 0.833° below the horizon once you allow for the sun's size and for the
// atmosphere bending its light.
const SUN_ALTITUDE = -0.833;

// Civil dawn and dusk: the sun 6° below the horizon. Before dawn and after
// dusk it's properly dark; between them and sunrise/sunset is twilight.
const CIVIL_TWILIGHT_ALTITUDE = -6;

// Golden hour: the warm light while the sun is low, ending at sunset. It's
// usually counted from when the sun drops below 6°.
const GOLDEN_HOUR_ALTITUDE = 6;

const toRad = deg => (deg * Math.PI) / 180;
const toDeg = rad => (rad * 180) / Math.PI;

const julianToDate = jd => new Date((jd - JULIAN_UNIX_EPOCH) * MS_PER_DAY);
const dateToJulian = date => date.getTime() / MS_PER_DAY + JULIAN_UNIX_EPOCH;

/** Same calendar day in the computer's local time zone? */
function sameLocalDay(a, b) {
    return a.getFullYear() === b.getFullYear() &&
        a.getMonth() === b.getMonth() &&
        a.getDate() === b.getDate();
}

/** Solar noon and the sun's position for day number `n` since J2000. */
function solarDay(n, longitude) {
    // Mean solar time: east is positive, so places further east hit noon
    // earlier (in UTC).
    const jStar = n - longitude / 360;

    const M = (357.5291 + 0.98560028 * jStar) % 360; // mean anomaly
    const Mr = toRad(M);
    const C = 1.9148 * Math.sin(Mr) + 0.02 * Math.sin(2 * Mr) +
        0.0003 * Math.sin(3 * Mr); // equation of the centre
    const lambda = (M + C + 180 + 102.9372) % 360; // ecliptic longitude
    const lambdaR = toRad(lambda);

    const transit = J2000 + jStar + 0.0053 * Math.sin(Mr) -
        0.0069 * Math.sin(2 * lambdaR); // solar noon (Julian date)
    const declination = Math.asin(Math.sin(lambdaR) * Math.sin(toRad(23.4397)));

    return {transit, declination};
}

/**
 * Cosine of the hour angle at which the sun is at `altitude` degrees. Below
 * -1 it never gets that low that day; above 1 it never gets that high.
 */
function cosHourAngle(altitude, latitude, declination) {
    const phi = toRad(latitude);
    return (Math.sin(toRad(altitude)) - Math.sin(phi) * Math.sin(declination)) /
        (Math.cos(phi) * Math.cos(declination));
}

/**
 * Sunrise, sunset, dawn and dusk for the local calendar day containing
 * `date`.
 *
 * Returns `{dawn, sunrise, sunset, dusk, noon, goldenHour}` as Date objects
 * (noon is solar noon, when the sun is highest; goldenHour is the evening
 * one, when the sun drops below 6°, or null if it never gets that high). Dawn and dusk are
 * civil twilight (sun 6° below the horizon). In summer far north the sky
 * never gets that dark, so dawn and dusk are null even though the sun sets.
 * Near the poles the sun can stay up or down all day; then everything is
 * null and `polar` is 'day' or 'night'.
 *
 * @param {Date} date any moment on the day you want
 * @param {number} latitude degrees, north positive
 * @param {number} longitude degrees, east positive
 */
export function getSunTimes(date, latitude, longitude) {
    // Start from noon of the local day, then pick the solar day whose noon
    // actually falls on that local date (time zones can push it by one).
    const localNoon = new Date(date.getFullYear(), date.getMonth(),
        date.getDate(), 12);
    let n = Math.round(dateToJulian(localNoon) - J2000 + longitude / 360);

    let day = solarDay(n, longitude);
    for (const shift of [-1, 1]) {
        if (sameLocalDay(julianToDate(day.transit), localNoon))
            break;
        const candidate = solarDay(n + shift, longitude);
        if (sameLocalDay(julianToDate(candidate.transit), localNoon)) {
            n += shift;
            day = candidate;
        }
    }

    // Solar noon (sun at its highest) exists every day, even near the poles.
    const none = {dawn: null, sunrise: null, sunset: null, dusk: null,
        goldenHour: null, noon: julianToDate(day.transit)};
    const cosSun = cosHourAngle(SUN_ALTITUDE, latitude, day.declination);
    if (cosSun < -1)
        return {...none, polar: 'day'}; // midnight sun
    if (cosSun > 1)
        return {...none, polar: 'night'}; // polar night

    const hourAngle = toDeg(Math.acos(cosSun)) / 360; // in days
    const result = {
        ...none,
        sunrise: julianToDate(day.transit - hourAngle),
        sunset: julianToDate(day.transit + hourAngle),
        polar: null,
    };

    const cosTwilight = cosHourAngle(CIVIL_TWILIGHT_ALTITUDE, latitude, day.declination);
    if (cosTwilight >= -1) {
        const twilightAngle = toDeg(Math.acos(cosTwilight)) / 360;
        result.dawn = julianToDate(day.transit - twilightAngle);
        result.dusk = julianToDate(day.transit + twilightAngle);
    }

    // On short winter days far north the sun never gets 6° up.
    const cosGolden = cosHourAngle(GOLDEN_HOUR_ALTITUDE, latitude, day.declination);
    if (cosGolden >= -1 && cosGolden <= 1)
        result.goldenHour = julianToDate(day.transit + toDeg(Math.acos(cosGolden)) / 360);
    return result;
}

/**
 * How high the sun is at `date`, in degrees above the horizon (negative when
 * it's below). Used to colour the day/night track in the settings window.
 */
export function getSunAltitude(date, latitude, longitude) {
    const n = Math.round(dateToJulian(date) - J2000 + longitude / 360);
    const {transit, declination} = solarDay(n, longitude);
    const hourAngle = toRad((dateToJulian(date) - transit) * 360);
    const phi = toRad(latitude);
    return toDeg(Math.asin(Math.sin(phi) * Math.sin(declination) +
        Math.cos(phi) * Math.cos(declination) * Math.cos(hourAngle)));
}
