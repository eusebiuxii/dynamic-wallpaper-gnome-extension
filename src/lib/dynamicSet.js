// SPDX-License-Identifier: GPL-2.0-or-later
// The "dynamic set": any number of pictures spread around the day, set up on
// the Dynamic set tab of the settings window.
//
// A set is scheduled one of two ways:
//
//   'time'  each picture starts at a clock time (minutes after midnight).
//   'sun'   each picture has a label tied to the sun (dawn, sunrise, midday,
//           ...). The labels' times are worked out for each day at your
//           location, so the pictures move with the seasons.
//
// In sun mode a picture can sit exactly on a label, or any number of minutes
// before or after it ("sunset + 20 min"). Pictures sitting exactly on the same
// label are spread evenly from that label's time to the next label's, in the
// order they were added.
//
// Like the rest of lib/, no GNOME imports, so it can be tested with `gjs`.

import {getSunTimes} from './sun.js';
import {atMinutes, cycleFromEvents, startOfDay} from './schedule.js';
import {planFromCycle} from './slideshow.js';

const MINUTE = 60_000;
const DAY_MINUTES = 24 * 60;
/** The furthest a sun-mode picture can be from its label, in minutes. */
export const MAX_OFFSET = DAY_MINUTES / 2;

/**
 * The sun labels, in the order they happen through a day: 12 for daytime
 * (dawn to dusk) and 5 for the night. `between` says how the in-between ones
 * are worked out.
 */
export const SUN_LABELS = Object.freeze([
    {id: 'dawn', name: 'Dawn', help: 'First light (civil dawn, the sun 6° below the horizon)'},
    {id: 'sunrise', name: 'Sunrise', help: 'The sun comes up'},
    {id: 'early-morning', name: 'Early morning', help: 'A quarter of the way from sunrise to midday'},
    {id: 'morning', name: 'Morning', help: 'Halfway from sunrise to midday'},
    {id: 'late-morning', name: 'Late morning', help: 'Three quarters of the way from sunrise to midday'},
    {id: 'midday', name: 'Midday', help: 'The sun at its highest'},
    {id: 'early-afternoon', name: 'Early afternoon', help: 'A quarter of the way from midday to sunset'},
    {id: 'afternoon', name: 'Afternoon', help: 'Halfway from midday to sunset'},
    {id: 'late-afternoon', name: 'Late afternoon', help: 'Three quarters of the way from midday to sunset'},
    {id: 'golden-hour', name: 'Golden hour', help: 'The sun drops below 6°: warm, low light'},
    {id: 'sunset', name: 'Sunset', help: 'The sun goes down'},
    {id: 'dusk', name: 'Dusk', help: 'Last light (civil dusk)'},
    {id: 'evening', name: 'Evening', help: 'A third of the way from dusk to midnight'},
    {id: 'night', name: 'Night', help: 'Two thirds of the way from dusk to midnight'},
    {id: 'midnight', name: 'Midnight', help: 'The sun at its lowest'},
    {id: 'late-night', name: 'Late night', help: 'A third of the way from midnight to dawn'},
    {id: 'before-dawn', name: 'Before dawn', help: 'Two thirds of the way from midnight to dawn'},
]);

// Labels from earlier versions, and what they became.
const OLD_LABELS = {'early-day': 'morning', 'late-day': 'afternoon'};

export const labelName = id => SUN_LABELS.find(l => l.id === id)?.name ?? id;

/** "Sunset", or "Sunset +20 min" / "Sunset −10 min" for a picture off the label. */
export function labelText({label, offset}) {
    if (!offset)
        return labelName(label);
    return `${labelName(label)} ${offset < 0 ? '−' : '+'}${Math.abs(offset)} min`;
}

/** The moment `fraction` of the way from `a` to `b` (null if either is). */
const between = (a, b, fraction) =>
    a && b ? new Date(a.getTime() + (b.getTime() - a.getTime()) * fraction) : null;

/**
 * When each sun label happens on the local day containing `day`. A label is
 * null when it doesn't happen that day: near the poles there may be no
 * sunrise, and in summer far north no dawn or dusk (and so no evening or
 * night labels either).
 *
 * Midnight is solar midnight (12 hours after solar noon), so it usually falls
 * just after the clock's midnight, on the next calendar day. Late night and
 * before dawn come after it, before the next day's dawn.
 *
 * @returns {Object<string, Date|null>}
 */
export function labelTimes(day, latitude, longitude) {
    const sun = getSunTimes(day, latitude, longitude);
    const nextDawn = getSunTimes(startOfDay(day, 1), latitude, longitude).dawn;
    const noon = sun.noon;
    const midnight = new Date(noon.getTime() + 12 * 60 * MINUTE);
    const lateAfternoon = between(noon, sun.sunset, 0.75);

    // Golden hour by the sun's height, but kept between late afternoon and
    // sunset so the labels stay in order (in midwinter the sun only just
    // gets above 6°, so that moment can come too early).
    let goldenHour = sun.goldenHour;
    if (lateAfternoon && !(goldenHour > lateAfternoon && goldenHour < sun.sunset))
        goldenHour = between(lateAfternoon, sun.sunset, 0.5);

    return {
        'dawn': sun.dawn,
        'sunrise': sun.sunrise,
        'early-morning': between(sun.sunrise, noon, 0.25),
        'morning': between(sun.sunrise, noon, 0.5),
        'late-morning': between(sun.sunrise, noon, 0.75),
        'midday': noon,
        'early-afternoon': between(noon, sun.sunset, 0.25),
        'afternoon': between(noon, sun.sunset, 0.5),
        'late-afternoon': lateAfternoon,
        'golden-hour': sun.sunset ? goldenHour : null,
        'sunset': sun.sunset,
        'dusk': sun.dusk,
        'evening': between(sun.dusk, midnight, 1 / 3),
        'night': between(sun.dusk, midnight, 2 / 3),
        'midnight': midnight,
        'late-night': between(midnight, nextDawn, 1 / 3),
        'before-dawn': between(midnight, nextDawn, 2 / 3),
    };
}

/** The labels that happen on `day`, in order, as `{id, time}`. */
export function availableLabels(day, latitude, longitude) {
    const times = labelTimes(day, latitude, longitude);
    return SUN_LABELS.filter(l => times[l.id]).map(l => ({id: l.id, time: times[l.id]}));
}

/**
 * When each picture in the set starts on the local day containing `day`.
 *
 * @param {Date} day
 * @param {object} set
 * @param {'time'|'sun'} set.mode
 * @param {number} set.latitude
 * @param {number} set.longitude
 * @param {{time: number, label: string, offset: number}[]} set.entries
 *     offset: minutes after the label (negative: before); sun mode only
 * @returns {(Date|null)[]} one per entry; null if its label doesn't happen
 */
export function entryTimes(day, set) {
    if (set.mode !== 'sun')
        return set.entries.map(entry => atMinutes(startOfDay(day), entry.time));

    const today = availableLabels(day, set.latitude, set.longitude);
    const tomorrow = availableLabels(startOfDay(day, 1), set.latitude, set.longitude);

    // Group the pictures sitting exactly on each label, keeping the order
    // they were added in. Pictures with an offset are placed on their own.
    const groups = new Map();
    const times = set.entries.map(() => null);
    set.entries.forEach((entry, i) => {
        if (entry.offset) {
            const label = today.find(l => l.id === entry.label);
            if (label)
                times[i] = new Date(label.time.getTime() + entry.offset * MINUTE);
            return;
        }
        if (!groups.has(entry.label))
            groups.set(entry.label, []);
        groups.get(entry.label).push(i);
    });

    today.forEach((label, i) => {
        const members = groups.get(label.id);
        if (!members)
            return;
        // Spread the pictures sharing a label up to the next label's time
        // (tomorrow's first one, for the last label of the day).
        const next = today[i + 1]?.time ?? tomorrow[0]?.time ??
            new Date(label.time.getTime() + DAY_MINUTES * MINUTE);
        const step = (next - label.time) / members.length;
        members.forEach((entryIndex, j) => {
            times[entryIndex] = new Date(label.time.getTime() + j * step);
        });
    });
    return times;
}

/**
 * Every picture change from two days ago to two days ahead, sorted, in the
 * `{time, phase}` form schedule.js uses. Each picture's phase is `#<index>`,
 * so the same image used twice still counts as two pictures.
 */
export function setEvents(now, set) {
    const events = [];
    for (let offset = -2; offset <= 2; offset++) {
        entryTimes(startOfDay(now, offset), set).forEach((time, i) => {
            if (time)
                events.push({time, phase: `#${i}`});
        });
    }
    return events.sort((a, b) => a.time - b.time);
}

/** The index of the picture showing at `now`, or -1 if there is none. */
export function currentEntry(now, set) {
    let phase = null;
    for (const event of setEvents(now, set)) {
        if (event.time > now)
            break;
        phase = event.phase;
    }
    return phase ? Number(phase.slice(1)) : -1;
}

/**
 * The slideshow for a set (the same shape as planSlideshow() in
 * slideshow.js). Entries need a `file` path. Returns null when there's
 * nothing to show.
 */
export function planSetSlideshow(now, set, fadeSeconds) {
    if (!set.entries.length)
        return null;
    const cycle = cycleFromEvents(now, setEvents(now, set));
    if (!cycle)
        return null;
    return planFromCycle(cycle, phase => set.entries[Number(phase.slice(1))].file,
        fadeSeconds);
}

/** Minutes after midnight for a Date, rounded to the nearest minute. */
export function minutesOfDay(date) {
    return Math.round(date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60) %
        DAY_MINUTES;
}

/** Distance between two times of day in minutes, going the short way round. */
function clockDistance(a, b) {
    const d = Math.abs(a - b) % DAY_MINUTES;
    return Math.min(d, DAY_MINUTES - d);
}

/** The label whose time on `day` is closest to `minutes` after midnight. */
export function nearestLabel(minutes, day, latitude, longitude) {
    return placeOnLabel(minutes, day, latitude, longitude, 0).label;
}

/**
 * Where a time of day sits relative to the sun on `day`: the nearest label
 * and how many minutes after it (negative: before). Within `snap` minutes of
 * a label it snaps onto it (offset 0).
 *
 * @returns {{label: string, offset: number}}
 */
export function placeOnLabel(minutes, day, latitude, longitude, snap) {
    let best = null;
    for (const label of availableLabels(day, latitude, longitude)) {
        const at = minutesOfDay(label.time);
        const distance = clockDistance(at, minutes);
        if (!best || distance < best.distance)
            best = {label: label.id, at, distance};
    }
    if (!best)
        return {label: 'midday', offset: 0};
    if (best.distance <= snap)
        return {label: best.label, offset: 0};
    // Signed difference, the short way round the clock.
    let offset = Math.round(minutes - best.at) % DAY_MINUTES;
    if (offset > DAY_MINUTES / 2)
        offset -= DAY_MINUTES;
    if (offset < -DAY_MINUTES / 2)
        offset += DAY_MINUTES;
    return {label: best.label, offset};
}

/**
 * Switching a set between 'time' and 'sun': fills in the other field of each
 * entry from `day`, so the pictures stay roughly where they were.
 *
 * @returns {object[]} new entries (the old ones aren't changed)
 */
export function convertEntries(entries, toMode, day, latitude, longitude) {
    if (toMode === 'sun') {
        return entries.map(entry => ({
            ...entry,
            ...placeOnLabel(entry.time, day, latitude, longitude, 0),
        }));
    }
    const times = entryTimes(day, {mode: 'sun', latitude, longitude, entries});
    return entries.map((entry, i) => ({
        ...entry,
        time: times[i] ? minutesOfDay(times[i]) : entry.time,
    }));
}

/**
 * Spreads the pictures evenly around the clock ('time' mode), keeping their
 * order and starting from the earliest one's time.
 */
export function spreadEvenly(entries) {
    if (!entries.length)
        return [];
    const order = entries.map((entry, i) => i).sort((a, b) => entries[a].time - entries[b].time);
    const first = entries[order[0]].time;
    const result = entries.map(entry => ({...entry}));
    order.forEach((entryIndex, i) => {
        result[entryIndex].time = Math.round(first + i * DAY_MINUTES / entries.length) % DAY_MINUTES;
    });
    return result;
}

/**
 * Reads the stored list of pictures (a JSON string in the settings), keeping
 * only well-formed entries.
 *
 * @returns {{uri: string, time: number, label: string, offset: number}[]}
 */
export function parseEntries(json) {
    let list;
    try {
        list = JSON.parse(json);
    } catch {
        return [];
    }
    if (!Array.isArray(list))
        return [];
    return list
        .filter(e => e && typeof e.uri === 'string' && e.uri)
        .map(e => ({
            uri: e.uri,
            time: Number.isFinite(e.time) ? ((Math.round(e.time) % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES : 0,
            label: SUN_LABELS.some(l => l.id === (OLD_LABELS[e.label] ?? e.label))
                ? OLD_LABELS[e.label] ?? e.label : 'midday',
            offset: Number.isFinite(e.offset)
                ? Math.max(-MAX_OFFSET, Math.min(MAX_OFFSET, Math.round(e.offset))) : 0,
        }));
}
