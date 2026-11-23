// Records the MouseVader demo video: dist/demo/mousevader-demo.mp4 (+ .srt and a thumbnail).
//   node demo/record.mjs
// Real Firefox (headed, on a private Xvfb display) with the add-on installed and pinned to the toolbar,
// a demo news site whose "tracker view" draws real (blue) and fake (red) pointer movement, the popup in
// a small window beside the toolbar, and the settings page. Narration: a stock Piper voice (not a person's).
// Needs: Xvfb, ffmpeg, Firefox (FIREFOX_BINARY), geckodriver (GECKODRIVER), Piper (~/piper/.venv/bin/piper).
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync, rmSync, mkdtempSync, existsSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Builder, By } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";
import { build, TEST_ID } from "../scripts/build.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const OUT = join(ROOT, "dist", "demo");
const SCRIPT = JSON.parse(readFileSync(join(HERE, "script.json"), "utf8"));
const W = 1920, H = 1080, DISPLAY = process.env.DEMO_DISPLAY || "97";
const PIPER = process.env.PIPER || join(homedir(), "piper", ".venv", "bin", "piper");
const VOICE = join(homedir(), "piper", "voices", SCRIPT.voice + ".onnx");
const FONT = execFileSync("fc-match", ["-f", "%{file}", "DejaVu Sans:bold"]).toString();
const FONT_REG = execFileSync("fc-match", ["-f", "%{file}", "DejaVu Sans"]).toString();
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ff = (...a) => execFileSync("nice", ["-n", "10", "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", ...a], { stdio: "inherit" });
const dur = f => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString());

mkdirSync(join(OUT, "audio"), { recursive: true });

// ---- 1. narration
const clips = SCRIPT.scenes.map((s, i) => {
  const wav = join(OUT, "audio", `${i + 1}-${s.id}.wav`), raw = wav + ".raw.wav";
  execFileSync("nice", ["-n", "10", PIPER, "-m", VOICE, "-f", raw, "--sentence-silence", "0.3"], { input: s.text.replace(/MouseVader/g, "Mouse Vader") });
  ff("-i", raw, "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", "48000", "-ac", "2", wav);
  rmSync(raw);
  return { ...s, wav, seconds: dur(wav) };
});
console.log(clips.map(c => `${c.id} ${c.seconds.toFixed(1)}s`).join(", "));

// ---- 2. the demo site, served as news.example (Firefox resolves it locally)
const SITE = readFileSync(join(HERE, "site.html"));
const server = createServer((q, r) => { r.writeHead(200, { "content-type": "text/html" }); r.end(SITE); });
await new Promise(r => server.listen(0, "127.0.0.1", r));
const SITE_URL = `http://news.example:${server.address().port}/`;

const work = mkdtempSync(join(tmpdir(), "mousevader-demo-"));
const xvfb = spawn("Xvfb", [`:${DISPLAY}`, "-screen", "0", `${W}x${H}x24`, "-nolisten", "tcp"], { stdio: "ignore" });
await sleep(1500);
process.env.DISPLAY = `:${DISPLAY}`;
let driver, grab;
try {
  const uuid = randomUUID(), EXT = `moz-extension://${uuid}`;
  const opts = new firefox.Options()
    .setPreference("extensions.webextensions.uuids", JSON.stringify({ [TEST_ID]: uuid }))
    .setPreference("network.dns.localDomains", "news.example")
    .setPreference("browser.shell.checkDefaultBrowser", false)
    .setPreference("browser.startup.homepage_override.mstone", "ignore")
    .setPreference("datareporting.policy.dataSubmissionEnabled", false)
    .setPreference("browser.toolbars.bookmarks.visibility", "never")
    .setPreference("ui.prefersReducedMotion", 0);
  if (process.env.FIREFOX_BINARY) opts.setBinary(process.env.FIREFOX_BINARY);
  const svc = (process.env.GECKODRIVER ? new firefox.ServiceBuilder(process.env.GECKODRIVER) : new firefox.ServiceBuilder())
    .addArguments("--allow-system-access").setEnvironment({ ...process.env, DISPLAY: `:${DISPLAY}` });
  driver = await new Builder().forBrowser("firefox").setFirefoxOptions(opts).setFirefoxService(svc).build();
  await driver.installAddon(build({ test: true, out: join(work, "mv.xpi") }), true);
  const chrome = async (code, ...args) => { await driver.setContext("chrome"); try { return await driver.executeScript(code, ...args); } finally { await driver.setContext("content"); } };
  const load = url => chrome("gBrowser.selectedBrowser.loadURI(Services.io.newURI(arguments[0]),{triggeringPrincipal:Services.scriptSecurityManager.getSystemPrincipal()})", url);

  // main window: full screen, MouseVader pinned to the toolbar
  const main = await driver.getWindowHandle();
  await driver.manage().window().setRect({ x: 0, y: 0, width: W, height: H });
  // hide the "browser under remote control" stripes and robot icon: this is a product demo
  const css = rules => "data:text/css," + encodeURIComponent(rules);
  const HIDE_REMOTE = css("#urlbar-background{background-image:none!important}" +
    " #urlbar[remotecontrol] #urlbar-background{background:var(--toolbar-field-background-color,#fff)!important}" +
    " #remote-control-box,#remote-control-icon{display:none!important}");
  const POPUP_FRAME = css(":root{border:1px solid #b8bec7!important; box-shadow:0 8px 24px rgba(0,0,0,.25)!important}");
  const styleWin = (sheet = HIDE_REMOTE) => chrome(`windowUtils.loadSheetUsingURIString(arguments[0], windowUtils.AUTHOR_SHEET)`, sheet);
  await styleWin();
  const unstripe = () => chrome(`const u = document.documentElement; u.removeAttribute("remotecontrol");
    new MutationObserver(() => u.removeAttribute("remotecontrol")).observe(u, { attributes: true, attributeFilter: ["remotecontrol"] });`);
  await unstripe();
  const widget = TEST_ID.toLowerCase().replace(/[^a-z0-9_-]/g, "_") + "-browser-action";
  await chrome(`CustomizableUI.addWidgetToArea(arguments[0], CustomizableUI.AREA_NAVBAR)`, widget);

  // the popup, in a small chrome-less window parked off screen until its scene
  await driver.switchTo().newWindow("window");
  const pop = await driver.getWindowHandle();
  await driver.manage().window().setRect({ x: 3000, y: 0, width: 360, height: 400 });
  await chrome(`for (const id of ["nav-bar","TabsToolbar","PersonalToolbar","titlebar","toolbar-menubar"]) { const e=document.getElementById(id); if (e) e.hidden = true; }`);
  await styleWin(POPUP_FRAME);
  const popupUrl = `${EXT}/src/popup.html`;
  const popup = async () => { await driver.switchTo().window(pop); await load(popupUrl); await sleep(900); };
  // start with MouseVader switched off, so its arrival is visible
  await popup();
  await driver.findElement(By.id("enabled")).click();
  await sleep(400);

  await driver.switchTo().window(main);
  await driver.get(SITE_URL);
  await sleep(2500);

  // real pointer: a gentle wander over these points (page coordinates)
  async function wander(points, stepMs = 220) {
    const a = driver.actions({ async: true });
    for (const [x, y] of points) a.move({ x, y, duration: stepMs });
    await a.perform();
  }
  const path = (n, x0, y0, x1, y1) => Array.from({ length: n }, (_, i) => {
    const t = i / (n - 1);
    return [Math.round(x0 + (x1 - x0) * t + 40 * Math.sin(t * 9)), Math.round(y0 + (y1 - y0) * t + 30 * Math.cos(t * 7))];
  });

  // ---- 3. record
  const raw = join(work, "raw.mp4");
  grab = spawn("nice", ["-n", "5", "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "x11grab", "-draw_mouse", "0",
    "-framerate", "30", "-video_size", `${W}x${H}`, "-i", `:${DISPLAY}.0`, "-c:v", "libx264", "-preset", "ultrafast", "-crf", "18", raw],
    { stdio: ["pipe", "ignore", "inherit"] });
  const t0 = Date.now();
  await sleep(500);
  const marks = {};
  async function scene(i, action) {
    const c = clips[i];
    marks[c.id] = (Date.now() - t0) / 1000;
    const started = Date.now();
    await (action ? action() : null);
    const left = (c.seconds + 0.8) * 1000 - (Date.now() - started);
    if (left > 0) await sleep(left);
  }

  await scene(0, async () => {                       // intro: only the real pointer (blue)
    await sleep(600);
    await wander(path(14, 250, 380, 700, 620));
    await wander(path(10, 900, 300, 1300, 520));
  });
  await scene(1, async () => {                       // MouseVader on: red appears
    await driver.switchTo().window(pop);
    await driver.findElement(By.id("enabled")).click();
    await driver.switchTo().window(main);
  });
  await scene(2, async () => {                       // the user opens a menu: fake activity pauses
    await sleep(500);
    const menu = await driver.findElement(By.id("sections"));
    const a = driver.actions({ async: true }).move({ origin: menu, duration: 500 });
    for (let k = 0; k < 18; k++) a.move({ origin: menu, x: -20 + (k * 13) % 60, y: 30 + (k * 17) % 90, duration: 250 });
    await a.perform();
  });
  await scene(3, async () => {                       // the popup: count, then "off on this site"
    await driver.switchTo().window(pop);
    await load(popupUrl); await sleep(700);
    await driver.manage().window().setRect({ x: W - 380, y: 82, width: 360, height: 400 });
    await sleep(clips[3].seconds * 1000 - 1800);
    await driver.findElement(By.id("site")).click();
  });
  await scene(4, async () => {                       // nothing here; back on; fast
    await sleep(3000);
    await driver.findElement(By.id("site")).click();
    await sleep(1200);
    await driver.findElement(By.css('#speed button[data-speed="fast"]')).click();
    await sleep(1500);
    await driver.manage().window().setRect({ x: 3000, y: 0, width: 360, height: 400 });
    await driver.switchTo().window(main);
  });
  await scene(5, async () => {                       // settings page
    await load(`${EXT}/src/options.html`);
    await sleep(1500);
    const input = await driver.findElement(By.id("newSite"));
    for (const ch of "mybank.example") { await input.sendKeys(ch); await sleep(70); }
    await sleep(300);
    await driver.findElement(By.css("#addForm button[type=submit]")).click();
    await sleep(900);
    await driver.findElement(By.css('#pause option[value="5000"]')).click();
  });
  const bodySeconds = (Date.now() - t0) / 1000;
  grab.stdin.write("q"); await new Promise(r => grab.on("exit", r)); grab = null;

  // ---- 4. cards, audio, captions, assembly
  const icon = join(ROOT, "icons", "darth-128.png");
  const card = (file, seconds, heading, sub, note = "") => ff(
    "-f", "lavfi", "-i", `color=c=0x0b0d12:s=${W}x${H}:d=${seconds}:r=30`, "-i", icon, "-filter_complex",
    `[1]scale=180:180[i];[0][i]overlay=(W-w)/2:300[b];[b]drawtext=fontfile=${FONT}:text='${heading}':fontcolor=white:fontsize=92:x=(w-text_w)/2:y=530,` +
    `drawtext=fontfile=${FONT_REG}:text='${sub}':fontcolor=0xfca5a5:fontsize=40:x=(w-text_w)/2:y=660` +
    (note ? `,drawtext=fontfile=${FONT_REG}:text='${note}':fontcolor=0x9ca3af:fontsize=32:x=(w-text_w)/2:y=730` : "") + ",format=yuv420p",
    "-t", String(seconds), "-c:v", "libx264", "-preset", "medium", "-crf", "20", file);
  const titleS = SCRIPT.title.seconds, endS = clips.at(-1).seconds + 2.0;
  card(join(work, "title.mp4"), titleS, SCRIPT.title.heading, SCRIPT.title.sub);
  card(join(work, "end.mp4"), endS, SCRIPT.end.heading, SCRIPT.end.sub, SCRIPT.end.note);
  ff("-i", raw, "-t", bodySeconds.toFixed(2), "-vf", "fps=30,format=yuv420p", "-c:v", "libx264", "-preset", "medium", "-crf", "20", join(work, "body.mp4"));
  writeFileSync(join(work, "list.txt"), ["title", "body", "end"].map(n => `file '${join(work, n + ".mp4")}'`).join("\n"));
  ff("-f", "concat", "-safe", "0", "-i", join(work, "list.txt"), "-c", "copy", join(work, "video.mp4"));

  const starts = clips.map((c, i) => i < clips.length - 1 ? titleS + marks[c.id] : titleS + bodySeconds + 0.6);
  const total = titleS + bodySeconds + endS;
  const inputs = clips.flatMap(c => ["-i", c.wav]);
  const mix = clips.map((c, i) => `[${i + 1}]adelay=${Math.round(starts[i] * 1000)}|${Math.round(starts[i] * 1000)}[a${i}]`).join(";") +
    ";" + clips.map((_, i) => `[a${i}]`).join("") + `amix=inputs=${clips.length}:normalize=0,apad[aud]`;
  const OUTFILE = join(OUT, "mousevader-demo.mp4");
  ff("-i", join(work, "video.mp4"), ...inputs, "-filter_complex", mix, "-map", "0:v", "-map", "[aud]", "-c:v", "copy",
     "-c:a", "aac", "-b:a", "160k", "-t", total.toFixed(2), "-movflags", "+faststart", OUTFILE);

  const ts = s => { const ms = Math.round(s * 1000), h = Math.floor(ms / 3600000), m = Math.floor(ms / 60000) % 60, sec = Math.floor(ms / 1000) % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`; };
  writeFileSync(join(OUT, "mousevader-demo.srt"), clips.map((c, i) => `${i + 1}\n${ts(starts[i])} --> ${ts(starts[i] + c.seconds)}\n${c.text}\n`).join("\n"));
  ff("-ss", (titleS + marks.noise + clips[1].seconds).toFixed(2), "-i", OUTFILE, "-frames:v", "1", join(OUT, "mousevader-demo-thumbnail.png"));
  console.log(`${OUTFILE} ${dur(OUTFILE).toFixed(1)} s`);
} finally {
  if (grab) grab.kill("SIGINT");
  if (driver) await driver.quit().catch(() => {});
  server.close();
  xvfb.kill();
  if (existsSync(work) && !process.env.DEMO_KEEP) rmSync(work, { recursive: true, force: true });
}
