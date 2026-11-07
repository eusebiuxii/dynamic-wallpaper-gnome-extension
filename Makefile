# Common tasks. Run `make help` to list them.
#
# The project folder has spaces in its name, so paths are always quoted.

UUID := dynamic-wallpaper@eusebiuxii.com
INSTALL_DIR := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
ZIP := dist/$(UUID).shell-extension.zip

# Lets the settings preview find a private library from GNOME's extensions app.
SHELL_LIBS := GI_TYPELIB_PATH=/usr/lib64/gnome-shell/girepository-1.0 LD_LIBRARY_PATH=/usr/lib64/gnome-shell

.PHONY: help test schemas prefs prefs-real link unlink pack install uninstall nested logs clean

help:
	@echo "make test        run the tests (sun maths and scheduling)"
	@echo "make prefs       open the settings window from src/, with throwaway settings"
	@echo "make prefs-real  same, but editing your real settings"
	@echo "make link        install for development: link src/ into GNOME's extensions folder"
	@echo "make unlink      remove that link"
	@echo "make pack        build the zip you'd upload to extensions.gnome.org"
	@echo "make install     install the built zip (like a user would)"
	@echo "make uninstall   remove the installed extension"
	@echo "make nested      start a test GNOME Shell in a window (needs mutter-devkit)"
	@echo "make logs        follow GNOME Shell's log, filtered to this extension"
	@echo "make clean       delete build output"

test:
	gjs -m tests/run.js

schemas:
	glib-compile-schemas --strict src/schemas

prefs: schemas
	GSETTINGS_BACKEND=memory $(SHELL_LIBS) gjs -m tests/prefs-window.js

prefs-real: schemas
	$(SHELL_LIBS) gjs -m tests/prefs-window.js

link: schemas
	mkdir -p "$(dir $(INSTALL_DIR))"
	ln -sfn "$(CURDIR)/src" "$(INSTALL_DIR)"
	@echo "Linked. Log out and back in (or use 'make nested'), then:"
	@echo "  gnome-extensions enable $(UUID)"

unlink:
	rm -f "$(INSTALL_DIR)"

pack: test
	mkdir -p dist
	gnome-extensions pack src --extra-source=lib --extra-source=dynamicSetPage.js --out-dir=dist --force
	@echo "Built $(ZIP)"

install: pack
	gnome-extensions install --force "$(ZIP)"
	@echo "Installed. Log out and back in, then: gnome-extensions enable $(UUID)"

uninstall:
	gnome-extensions uninstall $(UUID)

nested: link
	dbus-run-session gnome-shell --devkit --wayland

logs:
	journalctl -f -o cat /usr/bin/gnome-shell | grep --line-buffered -i -E "dynamic.wallpaper|$(UUID)"

clean:
	rm -rf dist src/schemas/gschemas.compiled
