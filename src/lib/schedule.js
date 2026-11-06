// SPDX-License-Identifier: GPL-2.0-or-later
// Works out which part of the day it is ("phase") and when that changes.
//
// Like sun.js, this file has no GNOME imports so it can be tested with plain
// `gjs`. The extension and the settings window both use it, so the preview in
// the settings always matches what the extension actually does.

import {getSunTimes} from './sun.js';

/** The four phases, in the order they happen through a day. */
export const Phase = Object.freeze({
    NIGHT: 'night',
    SUNRISE: 'sunrise',
    DAY: 'day',
    SUNSET: 'sunset',
});

const MINUTE = 60_000;

/**
 * Turns one day's boundaries (see boundariesForDay) into a list of phase
 * changes.
 *
 * Without transitions, day runs from sunrise to sunset.
 *
 * With transitions on, the sunrise wallpaper shows for `transitionMinutes`
 * starting at dawn, and the sunset wallpaper for `transitionMinutes` ending
 * at dusk. Where there's no dawn or dusk (set times, or summer far north
 * where it never gets dark) sunrise and sunset are used instead. If the day
 * is too short for both, they share it half each.
 */
function eventsForDay({lightStart, darkStart, dawn, dusk}, transitions, transitionMinutes) {
    if (!transitions) {
        return [
            {time: lightStart, phase: Phase.DAY},
            {time: darkStart, phase: Phase.NIGHT},
        ];
    }

    const start = (dawn ?? lightStart).getTime();
    const end = (dusk ?? darkStart).getTime();
    const middle = (start + end) / 2;
    const length = transitionMinutes * MINUTE;

    const events = [
        {time: new Date(start), phase: Phase.SUNRISE},
        {time: new Date(Math.min(start + length, middle)), phase: Phase.DAY},
        {time: new Date(Math.max(end - length, middle)), phase: Phase.SUNSET},
        {time: new Date(end), phase: Phase.NIGHT},
    ];
    // On short days the day phase can end up zero minutes long; drop any
    // phase that ends the moment it starts.
    return events.filter((event, i) => i === events.length - 1 ||
        event.time.getTime() !== events[i + 1].time.getTime());
}

/** Local midnight at the start of `date`'s day, shifted by `days`. */
function startOfDay(date, days = 0) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

/** `minutes` after local midnight on `day`. Handles daylight-saving days. */
function atMinutes(day, minutes) {
    return new Date(day.getFullYear(), day.getMonth(), day.getDate(),
        Math.floor(minutes / 60), minutes % 60);
}

/**
 * The light/dark boundaries for one day: sunrise and sunset (lightStart,
 * darkStart) and civil dawn and dusk. Set times have no twilight, so there
 * dawn and dusk are null.
 *
 * @returns {{lightStart: Date, darkStart: Date, dawn: ?Date, dusk: ?Date} |
 *     {polar: string, day: Date}}
 */
export function boundariesForDay(day, config) {
    if (config.mode === 'fixed') {
        const lightStart = atMinutes(day, config.dayStart);
        let darkStart = atMinutes(day, config.nightStart);
        // "Night starts" before "day starts" means night begins after
        // midnight, i.e. on the next calendar day.
        if (darkStart <= lightStart)
            darkStart = atMinutes(startOfDay(day, 1), config.nightStart);
        return {lightStart, darkStart, dawn: null, dusk: null};
    }

    const sun = getSunTimes(day, config.latitude, config.longitude);
    if (sun.polar)
        return {polar: sun.polar, day: startOfDay(day)};
    return {lightStart: sun.sunrise, darkStart: sun.sunset, dawn: sun.dawn, dusk: sun.dusk};
}

/**
 * Every phase change from two days ago to two days ahead, sorted. Looking
 * either side of today covers time zones, after-midnight night starts, and
 * the moment just after midnight when "now" still belongs to yesterday's
 * night.
 */
function eventsAround(now, config) {
    const events = [];
    for (let offset = -2; offset <= 2; offset++) {
        const day = startOfDay(now, offset);
        const b = boundariesForDay(day, config);
        if (b.polar) {
            events.push({time: b.day, phase: b.polar === 'day' ? Phase.DAY : Phase.NIGHT});
            continue;
        }
        events.push(...eventsForDay(b,
            config.transitions, config.transitionMinutes));
    }
    return events.sort((a, b) => a.time - b.time);
}

/**
 * The phase at `now`, and when the next change happens.
 *
 * @param {Date} now
 * @param {object} config
 * @param {'sun'|'fixed'} config.mode
 * @param {number} config.latitude used in 'sun' mode
 * @param {number} config.longitude used in 'sun' mode
 * @param {number} config.dayStart minutes after midnight, 'fixed' mode
 * @param {number} config.nightStart minutes after midnight, 'fixed' mode
 * @param {boolean} config.transitions show sunrise and sunset wallpapers
 * @param {number} config.transitionMinutes how long each one shows
 * @returns {{phase: string, nextChange: Date | null}}
 */
export function getPhase(now, config) {
    const events = eventsAround(now, config);

    let phase = Phase.NIGHT;
    let nextChange = null;
    for (const event of events) {
        if (event.time <= now) {
            phase = event.phase;
        } else if (event.phase !== phase) {
            nextChange = event.time;
            break;
        }
    }
    return {phase, nextChange};
}

/**
 * Today's phase changes, for showing in the settings window.
 *
 * @returns {{polar: string | null, events: {time: Date, phase: string}[]}}
 */
export function getTodaysEvents(now, config) {
    const today = startOfDay(now);
    const tomorrow = startOfDay(now, 1);
    const b = boundariesForDay(today, config);
    if (b.polar)
        return {polar: b.polar, events: []};

    const events = eventsForDay(b,
        config.transitions, config.transitionMinutes)
        .filter(e => e.time >= today && e.time < tomorrow);
    return {polar: null, events};
}

/**
 * Which wallpaper to show for a phase. Sunrise and sunset fall back to the
 * day wallpaper if they're not set (the sun is still up for both).
 *
 * @returns {string} a file URI, or '' if there's nothing to show
 */
export function wallpaperForPhase(phase, wallpapers) {
    switch (phase) {
    case Phase.NIGHT:
        return wallpapers.night;
    case Phase.SUNRISE:
        return wallpapers.sunrise || wallpapers.day;
    case Phase.SUNSET:
        return wallpapers.sunset || wallpapers.day;
    default:
        return wallpapers.day;
    }
}
