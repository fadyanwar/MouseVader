# MouseVader

Many companies, including Facebook and Google, track what you do on their own sites and on other sites that use their services. One common signal is where your mouse pointer goes: which parts of the page you hover over, how long you stay, what you skip. From that behaviour you can be sorted into groups for ad targeting. You can see it happen in your browser's network tab: hovering over parts of some pages sends requests.

MouseVader adds noise to that data. While you're on a page it makes fake pointer visits to random elements: it enters an element, moves around inside it for a moment and leaves, the way a mouse does. Trackers record these visits next to your real ones, so over time the profile they build of you becomes much less accurate.

Install it on Firefox: https://addons.mozilla.org/en-US/firefox/addon/mousevader

## What's new in 2.0

- **Settings you can reach from the toolbar.** The popup has:
  - a switch for MouseVader on every site;
  - a switch to run it on the current site or not;
  - a speed setting (Slow, Normal, Fast);
  - a live count of fake events on the current tab.

  The toolbar badge shows the count, or `off`.
- **Excluded sites.** The options page keeps a list of sites where MouseVader does nothing. `example.com` covers the site and its subdomains, and `*.example.com` covers only the subdomains. You can paste a page address and it keeps just the site.
- **Keyboard shortcut.** <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>M</kbd> switches MouseVader on or off. Firefox lets you change it in *Manage Extension Shortcuts*.
- **More realistic noise.** Each fake visit is a full pointer path:
  - `pointerover`/`mouseover` and `pointerenter`/`mouseenter`;
  - several `pointermove`/`mousemove` events at coordinates inside the element;
  - then `pointerout`/`mouseout` and `pointerleave`/`mouseleave`.

  Dwell times and the gaps between visits are random. Targets include links, images, headings, list items, articles and table cells, not only `div`s. Every element on the page can be chosen; the previous version never chose the first one.
- **It stays out of your way.**
  - It pauses for a few seconds after your own mouse, keyboard or scrolling, so it doesn't close a menu you just opened. The pause length is a setting.
  - It never hovers the element under your real pointer or its parents.
  - It never touches form fields, video, audio, frames or editable areas.
  - It never clicks, types, scrolls or focuses anything.
- **Background tabs.** It can keep adding noise in tabs you aren't looking at (the default) or pause there.
- **Quiet.** It no longer logs to every page's console. Logging is an option for troubleshooting.

## Privacy

MouseVader only needs the `storage` permission. Your settings stay in your browser. It sends nothing anywhere, has no analytics and makes no network requests.

## Limits

Browsers mark events made by scripts as untrusted (`event.isTrusted` is `false`). A tracker that checks this flag can tell MouseVader's events from real ones and drop them. Many trackers don't check, but no extension can make its events trusted.

MouseVader works on the page's top-level document, not inside embedded frames. Browsers don't let extensions run on their own pages (the add-on store, settings pages, the PDF viewer), so the popup says "Not available on this page" there.

## Develop

You need Node.js 22 or later, Firefox, and [geckodriver](https://github.com/mozilla/geckodriver/releases) for the end-to-end tests.

```console
npm install
npm test               # unit tests (core logic) and system tests (content script in a simulated page)
npm run test:e2e       # end-to-end: real Firefox, the add-on installed, popup and options driven like a person would
npm run build          # dist/mousevader-<version>.xpi
```

The end-to-end tests run Firefox headless; set `E2E_HEADFUL=1` to watch. Set `FIREFOX_BINARY` and `GECKODRIVER` if they aren't on your `PATH`, and `SCREENSHOTS=<dir>` to save screenshots of the popup and options page.

| Layer | What it covers |
|---|---|
| Unit (`test/unit`) | site patterns and matching, settings validation, exclude/include a site, timing and back-off, random target selection, the shape of a fake visit, the toolbar badge |
| System (`test/system`) | the real content script in a jsdom page with a fake extension API: complete untrusted visits with coordinates inside each element, nothing on form fields, media or editable areas, on/off and exclusion take effect at once, the pause after user activity, avoiding the element under the pointer, background tabs, single injection |
| End-to-end (`test/e2e`) | real Firefox with the add-on: fake visits reach a "tracker" page, real mouse movement pauses them, and the popup and options page work: per-site off, global off, speed, exclusions with validation, persistence, reset |

To try it by hand, load `manifest.json` from *about:debugging* → *This Firefox* → *Load Temporary Add-on*.

Building for the add-on store: `npm run build` writes the package. If the store listing has an add-on ID, add it to `manifest.json` under `browser_specific_settings.gecko.id` before uploading a new version. `npm run build -- --test` makes a test-only package with a fixed ID; don't ship it.

## Layout

```
manifest.json         Firefox manifest (MV2)
src/core.js           pure logic shared by everything (unit tested)
src/content.js        the fake activity, injected into pages
src/background.js     toolbar badge and keyboard shortcut
src/popup.*           toolbar popup
src/options.*         settings page
src/ui.css            shared styles (light and dark)
icons/                icons (darth.png is the original artwork)
scripts/build.mjs     packaging
test/                 unit, system and end-to-end tests, and the test page
```

Written by Fady Anwar.
