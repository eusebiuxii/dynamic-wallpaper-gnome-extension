// SPDX-License-Identifier: GPL-2.0-or-later
// Builds a GNOME "slideshow" wallpaper: an XML file listing which picture to
// show for how long, and fades between them.
//
// Why: GNOME Shell draws the wallpaper at login *before* extensions start.
// If the extension set an image file, you'd see yesterday's picture for a
// moment before it swapped. With a slideshow file, GNOME works out the right
// picture from the clock itself, so it's right from the first frame. It also
// does the fades for us, and re-checks after sleep and time zone changes.
//
// The format (the same one GNOME's own day/night wallpapers use):
//
//   <background>
//     <starttime> year month day hour minute second (local time) </starttime>
//     <transition type="overlay"> duration from to </transition>  a fade
//     <static> duration file </static>                             a still
//     ...
//   </background>
//
// Durations are in seconds. When the list runs out GNOME starts again from
// the top, so a list adding up to 24 hours repeats daily.
//
// No GNOME imports here, so it can be tested with plain `gjs`.

import {getCycle, wallpaperForPhase} from './schedule.js';

const DAY_SECONDS = 24 * 60 * 60;

const escape = text => text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

/**
 * Works out the pieces of the slideshow: one per stretch of the day that
 * shows the same picture, each starting with a fade from the one before.
 *
 * @param {Date} now
 * @param {object} config the same config as getPhase() in schedule.js
 * @param {{day: string, night: string, sunrise: string, sunset: string}} files
 *     image paths ('' when not set)
 * @param {number} fadeSeconds how long each fade lasts (0 = swap instantly)
 * @returns {{start: Date, slides: {file: string, seconds: number, fade: number}[]} | null}
 *     null when there are no pictures at all
 */
export function planSlideshow(now, config, files, fadeSeconds) {
    // With only one of day and night set, show it all the time (the same as
    // the extension did before: nothing to switch to).
    const day = files.day || files.night;
    const night = files.night || files.day;
    if (!day)
        return null;
    const wallpapers = {...files, day, night};

    const {start, segments} = getCycle(now, config);

    // Whole seconds from the start, so the pieces add up to exactly a day.
    const startMs = Math.floor(start.getTime() / 1000) * 1000;
    const offset = date => Math.min(DAY_SECONDS,
        Math.max(0, Math.floor((date.getTime() - startMs) / 1000)));

    // Neighbours showing the same picture (a sunrise with no picture of its
    // own shows the day one) become one piece.
    const pieces = [];
    for (const segment of segments) {
        const file = wallpaperForPhase(segment.phase, wallpapers);
        const last = pieces[pieces.length - 1];
        if (last && last.file === file)
            last.end = offset(segment.end);
        else
            pieces.push({file, begin: offset(segment.start), end: offset(segment.end)});
    }
    pieces[pieces.length - 1].end = DAY_SECONDS;
    const kept = pieces.filter(piece => piece.end > piece.begin);

    // The first piece fades in from the last one, as the cycle repeats.
    // A fade can't be longer than the piece it fades into.
    const slides = kept.map((piece, i) => {
        const seconds = piece.end - piece.begin;
        const previous = kept[(i - 1 + kept.length) % kept.length];
        const fade = previous.file === piece.file ? 0
            : Math.min(Math.max(0, Math.round(fadeSeconds)), seconds);
        return {file: piece.file, seconds, fade};
    });

    return {start: new Date(startMs), slides};
}

/**
 * Turns a plan from planSlideshow() into the XML GNOME reads.
 *
 * @returns {string}
 */
export function slideshowXml({start, slides}) {
    const lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<!-- Written by the Dynamic Wallpaper extension. It is rewritten',
        '     every time the wallpaper changes, so edits here will be lost. -->',
        '<background>',
        '  <starttime>',
        `    <year>${start.getFullYear()}</year>`,
        `    <month>${start.getMonth() + 1}</month>`,
        `    <day>${start.getDate()}</day>`,
        `    <hour>${start.getHours()}</hour>`,
        `    <minute>${start.getMinutes()}</minute>`,
        `    <second>${start.getSeconds()}</second>`,
        '  </starttime>',
    ];

    slides.forEach((slide, i) => {
        const previous = slides[(i - 1 + slides.length) % slides.length];
        if (slide.fade > 0) {
            lines.push(
                '  <transition type="overlay">',
                `    <duration>${slide.fade}</duration>`,
                `    <from>${escape(previous.file)}</from>`,
                `    <to>${escape(slide.file)}</to>`,
                '  </transition>');
        }
        if (slide.seconds > slide.fade) {
            lines.push(
                '  <static>',
                `    <duration>${slide.seconds - slide.fade}</duration>`,
                `    <file>${escape(slide.file)}</file>`,
                '  </static>');
        }
    });

    lines.push('</background>', '');
    return lines.join('\n');
}
