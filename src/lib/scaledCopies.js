// SPDX-License-Identifier: GPL-2.0-or-later
// Screen-sized copies of the wallpaper pictures.
//
// GNOME loads the wallpaper at its full size, whatever the screen size. A
// 6016×6016 picture takes about 145 MB of memory once decoded, and GNOME
// decodes it again for every change. Other extensions that draw the
// wallpaper too (Blur my Shell, for example) redraw it whenever it changes.
// A copy just big enough to cover the screen is around a tenth of that, so
// changes, fades and logins are lighter for everything that draws it.
//
// The copies live in ~/.cache/dynamic-wallpaper/scaled. They're named after
// the original's path, size, change time and the screen size, so a changed
// picture or a different screen gets a new copy. Everything here is async:
// decoding a large picture takes a second or two, and GNOME Shell must not
// freeze while it happens.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GdkPixbuf from 'gi://GdkPixbuf';

// A picture less than this much bigger than the screen is used as it is.
const MIN_SHRINK = 1.15;

const JPEG_QUALITY = '92';

export function call(start, finish) {
    return new Promise((resolve, reject) => {
        start((source, result) => {
            try {
                resolve(finish(source, result));
            } catch (e) {
                reject(e);
            }
        });
    });
}

/**
 * The size, in real pixels, that a copy has to cover: the biggest screen.
 *
 * @returns {{width: number, height: number}}
 */
export function screenSize() {
    const display = global.display;
    let width = 0, height = 0;
    for (let i = 0; i < display.get_n_monitors(); i++) {
        const rect = display.get_monitor_geometry(i);
        const scale = display.get_monitor_scale(i);
        width = Math.max(width, Math.ceil(rect.width * scale));
        height = Math.max(height, Math.ceil(rect.height * scale));
    }
    return {width, height};
}

/**
 * A copy of `path` that just covers `screen`, made if it isn't there yet.
 * Falls back to `path` itself when it's small already or can't be read.
 *
 * @param {string} path the original picture
 * @param {{width: number, height: number}} screen
 * @param {string} dir where copies are kept
 * @param {Gio.Cancellable} cancellable
 * @returns {Promise<string>} the path to use in the slideshow
 */
export async function scaledCopy(path, screen, dir, cancellable) {
    if (!screen.width || !screen.height)
        return path;
    try {
        const file = Gio.File.new_for_path(path);
        const info = await call(
            cb => file.query_info_async('standard::size,time::modified',
                Gio.FileQueryInfoFlags.NONE, GLib.PRIORITY_LOW, cancellable, cb),
            (f, res) => f.query_info_finish(res));
        const key = [path, info.get_size(), info.get_modification_date_time()?.to_unix() ?? 0,
            screen.width, screen.height].join('\n');
        const hash = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA1, key, -1);

        for (const ext of ['jpg', 'png']) {
            const existing = GLib.build_filenamev([dir, `${hash}.${ext}`]);
            if (GLib.file_test(existing, GLib.FileTest.EXISTS))
                return existing;
        }

        const [format, width, height] = await call(
            cb => GdkPixbuf.Pixbuf.get_file_info_async(path, cancellable, cb),
            (_s, res) => GdkPixbuf.Pixbuf.get_file_info_finish(res));
        if (!format || !width || !height)
            return path;

        // Scale so the picture covers the screen (as "Zoom" shows it).
        const scale = Math.max(screen.width / width, screen.height / height);
        if (scale * MIN_SHRINK > 1)
            return path;

        const stream = await call(
            cb => file.read_async(GLib.PRIORITY_LOW, cancellable, cb),
            (f, res) => f.read_finish(res));
        const pixbuf = await call(
            cb => GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(stream,
                Math.ceil(width * scale), Math.ceil(height * scale), true, cancellable, cb),
            (_s, res) => GdkPixbuf.Pixbuf.new_from_stream_finish(res));
        stream.close(null);

        const png = pixbuf.get_has_alpha() || format.get_name() === 'png';
        const target = GLib.build_filenamev([dir, `${hash}.${png ? 'png' : 'jpg'}`]);
        GLib.mkdir_with_parents(dir, 0o755);
        // replace() writes to a temporary file and renames it on close, so
        // a half-written copy is never used.
        const out = await call(
            cb => Gio.File.new_for_path(target).replace_async(null, false,
                Gio.FileCreateFlags.REPLACE_DESTINATION, GLib.PRIORITY_LOW, cancellable, cb),
            (f, res) => f.replace_finish(res));
        await call(
            cb => png
                ? pixbuf.save_to_streamv_async(out, 'png', [], [], cancellable, cb)
                : pixbuf.save_to_streamv_async(out, 'jpeg', ['quality'], [JPEG_QUALITY],
                    cancellable, cb),
            (_s, res) => GdkPixbuf.Pixbuf.save_to_stream_finish(res));
        await call(
            cb => out.close_async(GLib.PRIORITY_LOW, cancellable, cb),
            (o, res) => o.close_finish(res));
        return target;
    } catch (e) {
        if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
            throw e;
        console.warn(`Dynamic Wallpaper: using ${path} at full size: ${e.message}`);
        return path;
    }
}

/** Deletes copies in `dir` whose names aren't in `keep`. */
export function removeUnusedCopies(dir, keep) {
    const folder = Gio.File.new_for_path(dir);
    let children;
    try {
        children = folder.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
    } catch {
        return; // no copies yet
    }
    let info;
    while ((info = children.next_file(null))) {
        const name = info.get_name();
        if (!keep(name)) {
            try {
                folder.get_child(name).delete(null);
            } catch {}
        }
    }
    children.close(null);
}
