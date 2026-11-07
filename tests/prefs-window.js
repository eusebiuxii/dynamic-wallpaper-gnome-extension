// SPDX-License-Identifier: GPL-2.0-or-later
// Opens the settings window straight from src/, without installing the
// extension or logging out. Handy while working on prefs.js.
//
//   gjs -m tests/prefs-window.js                       open it
//   gjs -m tests/prefs-window.js --page schedule       start on a page
//   gjs -m tests/prefs-window.js --set use-transitions=true
//   gjs -m tests/prefs-window.js --search london       type into the city search
//   gjs -m tests/prefs-window.js --page dynamic-set --select 0   select a picture
//   gjs -m tests/prefs-window.js --size 660x1300       window size
//   gjs -m tests/prefs-window.js --scroll-end          scroll to the bottom of the page
//   gjs -m tests/prefs-window.js --screenshot out.png  save a picture and quit
//
// Settings live in memory only (GSETTINGS_BACKEND=memory, set by `make
// prefs`), so nothing you click here touches your real settings. Run it
// without that variable to edit the real ones.

import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import System from 'system';

// prefs.js imports ExtensionPreferences from GNOME's extensions app, which
// lives in this resource bundle. Registering it makes that import work here.
Gio.Resource.load('/usr/share/gnome-shell/org.gnome.Shell.Extensions.src.gresource')._register();

const srcDir = Gio.File.new_for_uri(import.meta.url).get_parent().get_parent().get_child('src');
const metadata = JSON.parse(new TextDecoder().decode(srcDir.get_child('metadata.json').load_contents(null)[1]));
metadata.dir = srcDir;
metadata.path = srcDir.get_path();

// Parse arguments.
let page = null, screenshot = null, search = null, select = null, size = null, scrollEnd = false;
const presets = [];
for (let i = 0; i < ARGV.length; i++) {
    if (ARGV[i] === '--page') page = ARGV[++i];
    else if (ARGV[i] === '--screenshot') screenshot = ARGV[++i];
    else if (ARGV[i] === '--set') presets.push(ARGV[++i]);
    else if (ARGV[i] === '--search') search = ARGV[++i];
    else if (ARGV[i] === '--select') select = Number(ARGV[++i]);
    else if (ARGV[i] === '--size') size = ARGV[++i].split('x').map(Number);
    else if (ARGV[i] === '--scroll-end') scrollEnd = true;
}

const {default: Preferences} = await import('../src/prefs.js');
const prefs = new Preferences(metadata);

if (presets.length) {
    const settings = prefs.getSettings();
    for (const preset of presets) {
        const [key, ...rest] = preset.split('=');
        const type = settings.get_value(key).get_type_string();
        settings.set_value(key, GLib.Variant.parse(new GLib.VariantType(type), rest.join('='), null, null));
    }
}

const app = new Adw.Application({application_id: 'com.eusebiuxii.DynamicWallpaper.PrefsPreview'});
app.connect('activate', () => {
    const window = new Adw.PreferencesWindow({application: app, title: metadata.name});
    prefs.fillPreferencesWindow(window);
    if (size)
        window.set_default_size(...size);
    if (page)
        window.set_visible_page_name(page);
    if (search) {
        // Type into the city search box, to preview the results list.
        const find = widget => {
            if (widget instanceof Adw.EntryRow)
                return widget;
            for (let c = widget.get_first_child(); c; c = c.get_next_sibling()) {
                const found = find(c);
                if (found)
                    return found;
            }
            return null;
        };
        find(window.get_visible_page())?.set_text(search);
    }
    if (select !== null)
        window.get_visible_page()._clock?.select(select);
    window.present();

    if (screenshot) {
        // Give it a moment to lay out and load thumbnails, then save.
        if (scrollEnd) {
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 700, () => {
                const findScroll = widget => {
                    if (widget instanceof Gtk.ScrolledWindow)
                        return widget;
                    for (let c = widget.get_first_child(); c; c = c.get_next_sibling()) {
                        const found = findScroll(c);
                        if (found)
                            return found;
                    }
                    return null;
                };
                const adj = findScroll(window.get_visible_page())?.get_vadjustment();
                adj?.set_value(adj.get_upper());
                return GLib.SOURCE_REMOVE;
            });
        }
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
            const paintable = new Gtk.WidgetPaintable({widget: window});
            const snapshot = Gtk.Snapshot.new();
            const [w, h] = [window.get_width(), window.get_height()];
            paintable.snapshot(snapshot, w, h);
            const texture = window.get_native().get_renderer().render_texture(snapshot.to_node(), null);
            texture.save_to_png(screenshot);
            print(`Saved ${screenshot}`);
            app.quit();
            return GLib.SOURCE_REMOVE;
        });
    }
});
System.exit(app.run([System.programInvocationName]));
