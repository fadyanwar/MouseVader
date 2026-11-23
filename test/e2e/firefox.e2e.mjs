// End-to-end: real Firefox, the built add-on installed, a local "tracker" page recording events,
// and the popup / options pages driven like a person would.
//   npm run test:e2e         (headless; E2E_HEADFUL=1 to watch)
// Env: FIREFOX_BINARY (path to firefox), GECKODRIVER (path to geckodriver) if not on PATH.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Builder, By, until } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";
import { build, TEST_ID } from "../../scripts/build.mjs";

const PAGE = readFileSync(new URL("../fixtures/page.html", import.meta.url));
const sleep = ms => new Promise(r => setTimeout(r, ms));

const server = createServer((req, res) => { res.writeHead(200, { "content-type": "text/html" }); res.end(PAGE); });
await new Promise(r => server.listen(0, "127.0.0.1", r));
const PORT = server.address().port;
const PAGE_IP = `http://127.0.0.1:${PORT}/`;
const PAGE_LOCAL = `http://localhost:${PORT}/`;

const work = mkdtempSync(join(tmpdir(), "mousevader-e2e-"));
const xpi = build({ test: true, out: join(work, "mousevader-test.xpi") });
const uuid = randomUUID();
const EXT = `moz-extension://${uuid}`;

const options = new firefox.Options()
  .setPreference("extensions.webextensions.uuids", JSON.stringify({ [TEST_ID]: uuid }))
  .addArguments("-width", "1280", "-height", "900");
if (!process.env.E2E_HEADFUL) options.addArguments("-headless");
if (process.env.FIREFOX_BINARY) options.setBinary(process.env.FIREFOX_BINARY);
const service = process.env.GECKODRIVER ? new firefox.ServiceBuilder(process.env.GECKODRIVER) : new firefox.ServiceBuilder();
service.addArguments("--allow-system-access");   // lets the test open the add-on's own pages (chrome context)
const driver = await new Builder().forBrowser("firefox").setFirefoxOptions(options).setFirefoxService(service).build();

const results = [];
const SHOTS = process.env.SCREENSHOTS;     // directory: save the popup and options page as PNGs
async function shot(name) {
  if (!SHOTS) return;
  const { writeFileSync, mkdirSync } = await import("node:fs");
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(join(SHOTS, name + ".png"), await driver.takeScreenshot(), "base64");
}
async function step(name, fn) {
  const t0 = Date.now();
  try { await fn(); results.push([true, name, Date.now() - t0]); console.log(`✔ ${name} (${Date.now() - t0} ms)`); }
  catch (e) { results.push([false, name, Date.now() - t0]); console.log(`✖ ${name}\n  ${e && e.stack || e}`); }
}
const summary = (since = 0) => driver.executeScript("return window.__summary(arguments[0])", since);
const pageNow = () => driver.executeScript("return performance.now()");
async function waitFake(min, ms, since = 0) {
  const end = Date.now() + ms;
  while (Date.now() < end) { const s = await summary(since); if (s.fake >= min) return s; await sleep(250); }
  return summary(since);
}

let pageTab, uiTab;
async function openUi(path) {
  if (!uiTab) { await driver.switchTo().newWindow("tab"); uiTab = await driver.getWindowHandle(); }
  else await driver.switchTo().window(uiTab);
  // WebDriver may not navigate a tab to moz-extension:// URLs; load it from the privileged context.
  await driver.setContext("chrome");
  await driver.executeScript(
    "gBrowser.selectedBrowser.loadURI(Services.io.newURI(arguments[0]), {triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal()})",
    `${EXT}/src/${path}`);
  await driver.setContext("content");
  await driver.wait(async () => (await driver.getCurrentUrl()).startsWith(`${EXT}/src/${path}`), 5000);
  await driver.wait(async () => (await driver.executeScript("return document.readyState")) === "complete", 5000);
}
async function toPage() { await driver.switchTo().window(pageTab); }
async function popupText() {
  const el = await driver.wait(until.elementLocated(By.id("state")), 5000);
  await driver.wait(async () => (await el.getText()) !== "…", 5000);
  return { state: await el.getText(), detail: await driver.findElement(By.id("detail")).getText() };
}

try {
  await driver.installAddon(xpi, true);
  await driver.get(PAGE_IP);
  pageTab = await driver.getWindowHandle();

  await step("adds untrusted pointer visits to a real page", async () => {
    const s = await waitFake(40, 20000);
    assert.ok(s.fake >= 40, `fake events: ${s.fake}`);
    for (const t of ["pointerover", "pointermove", "mouseover", "mousemove", "mouseout", "pointerout"])
      assert.ok(s.fakeTypes.includes(t), `type ${t} in ${s.fakeTypes}`);
    assert.ok(!s.fakeTypes.some(t => ["click", "mousedown", "focusin", "input"].includes(t)), "no clicks, focus or input");
    assert.ok(!s.fakeTags.some(t => ["INPUT", "TEXTAREA", "VIDEO"].includes(t)), `tags: ${s.fakeTags}`);
    assert.equal(s.real, 0);
  });

  await step("pauses while the user moves the real mouse, then resumes", async () => {
    // Move the real pointer around for 5 s (trusted events), then watch.
    const grid = await driver.findElement(By.id("grid"));
    const t0 = await pageNow();
    const actions = driver.actions({ async: true });
    for (let i = 0; i < 25; i++) actions.move({ origin: grid, x: -300 + (i * 23) % 600, y: -40 + (i * 7) % 80, duration: 150 }).pause(50);
    await actions.perform();
    const t1 = await pageNow();
    const during = await summary(t0);
    assert.ok(during.real > 10, `real events recorded: ${during.real}`);
    // fake events may finish a visit already under way at t0 (< 1 s); none may start later during the movement
    const late = during.fakeTimes.filter(t => t > t0 + 1000 && t < t1);
    assert.equal(late.length, 0, `fake events during real movement: ${late.length}`);
    const after = await waitFake(5, 20000, t1 + 3000);
    assert.ok(after.fake >= 5, "resumes after the pause");
  });

  await step("popup shows the site and a live event count", async () => {
    await openUi("popup.html");
    const { state, detail } = await popupText();
    assert.match(state, /Adding noise on 127\.0\.0\.1/);
    assert.match(detail, /[1-9][\d,]* fake events on this tab/);
    assert.equal(await driver.findElement(By.id("siteName")).getText(), "127.0.0.1");
    assert.equal(await driver.findElement(By.id("enabled")).isSelected(), true);
    await shot("popup-on");
  });

  await step("popup: 'Run on this site' off stops the page; on resumes it", async () => {
    await driver.findElement(By.id("site")).click();
    await driver.wait(async () => /Off on 127\.0\.0\.1/.test((await popupText()).state), 5000);
    await toPage();
    await sleep(1500);                                   // in-flight visit finishes its out events
    const t = await pageNow();
    await sleep(5000);
    assert.equal((await summary(t)).fake, 0, "no events while excluded");
    await openUi("popup.html");
    assert.match((await driver.findElement(By.id("detail")).getText()) || (await popupText()).detail, /Excluded by “127\.0\.0\.1”/);
    await driver.findElement(By.id("site")).click();
    await driver.wait(async () => /Adding noise/.test((await popupText()).state), 5000);
    await toPage();
    assert.ok((await waitFake(5, 20000, await pageNow())).fake >= 5, "resumes");
  });

  await step("popup: global switch off stops everything; speed buttons save", async () => {
    await openUi("popup.html");
    await popupText();
    await driver.findElement(By.css('#speed button[data-speed="fast"]')).click();
    await driver.wait(async () => (await driver.findElement(By.css('#speed button[data-speed="fast"]')).getAttribute("aria-pressed")) === "true", 3000);
    await driver.findElement(By.id("enabled")).click();
    await driver.wait(async () => /Off everywhere/.test((await popupText()).state), 5000);
    assert.equal(await driver.findElement(By.id("site")).isEnabled(), false, "site switch disabled while off");
    await toPage();
    await sleep(1500);
    const t = await pageNow();
    await sleep(5000);
    assert.equal((await summary(t)).fake, 0, "no events while off");
    await openUi("popup.html");
    await popupText();
    await driver.findElement(By.id("enabled")).click();
    await driver.wait(async () => /Adding noise/.test((await popupText()).state), 5000);
    await toPage();
    assert.ok((await waitFake(10, 15000, await pageNow())).fake >= 10);
  });

  await step("options page: validates, excludes localhost, lists and removes it", async () => {
    await openUi("options.html");
    const input = await driver.wait(until.elementLocated(By.id("newSite")), 5000);
    await input.sendKeys("not a site");
    await driver.findElement(By.css("#addForm button[type=submit]")).click();
    await driver.wait(async () => /doesn't look like a site/.test(await driver.findElement(By.id("addError")).getText()), 3000);
    await input.clear();
    await input.sendKeys(`${PAGE_LOCAL}some/path`);
    await driver.findElement(By.css("#addForm button[type=submit]")).click();
    await driver.wait(async () => (await driver.findElement(By.id("sites")).getText()).includes("localhost"), 3000);
    assert.equal(await driver.findElement(By.id("addError")).getText(), "");
    await shot("options");

    // a page on localhost gets nothing; the 127.0.0.1 page still does
    await toPage();
    await driver.get(PAGE_LOCAL);
    await sleep(6000);
    assert.equal((await summary()).fake, 0, "excluded localhost page");
    await openUi("popup.html");
    assert.match((await popupText()).state, /Off on localhost/);
    await shot("popup-excluded");

    await openUi("options.html");
    await driver.wait(until.elementLocated(By.css('button[aria-label="Remove localhost"]')), 5000).click();
    await driver.wait(async () => /No excluded sites/.test(await driver.findElement(By.id("sites")).getText()), 3000);
    await toPage();
    assert.ok((await waitFake(10, 20000)).fake >= 10, "localhost runs again");
  });

  await step("options page: settings persist across a reload; reset restores defaults", async () => {
    await openUi("options.html");
    const pause = await driver.wait(until.elementLocated(By.id("pause")), 5000);
    await pause.findElement(By.css('option[value="10000"]')).click();
    await driver.findElement(By.id("debug")).click();
    await sleep(300);
    await openUi("options.html");                         // reload the page
    await driver.wait(async () => (await driver.findElement(By.id("pause")).getAttribute("value")) === "10000", 5000);
    assert.equal(await driver.findElement(By.id("debug")).isSelected(), true);
    await driver.findElement(By.id("reset")).click();
    await driver.wait(async () => (await driver.findElement(By.id("pause")).getAttribute("value")) === "3000", 3000);
    assert.equal(await driver.findElement(By.id("debug")).isSelected(), false);
    assert.equal(await driver.findElement(By.css('#speed button[data-speed="normal"]')).getAttribute("aria-pressed"), "true");
  });
} finally {
  await driver.quit().catch(() => {});
  server.close();
  rmSync(work, { recursive: true, force: true });
}

const failed = results.filter(r => !r[0]);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
