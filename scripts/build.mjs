// Builds the Firefox package: dist/mousevader-<version>.xpi
//   node scripts/build.mjs            release package (manifest unchanged)
//   node scripts/build.mjs --test     test package for the e2e suite (adds a fixed add-on id so the
//                                     test can open the popup and options pages); never ship it
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const FILES = ["manifest.json", "src", "icons/darth-16.png", "icons/darth-32.png", "icons/darth-48.png",
                      "icons/darth-64.png", "icons/darth-96.png", "icons/darth-128.png"];
export const TEST_ID = "mousevader-test@mousevader.invalid";

export function build({ test = false, out } = {}) {
  const manifest = JSON.parse(readFileSync(join(ROOT, "manifest.json"), "utf8"));
  const stage = mkdtempSync(join(tmpdir(), "mousevader-build-"));
  try {
    for (const f of FILES) cpSync(join(ROOT, f), join(stage, f), { recursive: true });
    if (test) {
      const bss = manifest.browser_specific_settings || {};
      manifest.browser_specific_settings = { ...bss, gecko: { ...(bss.gecko || {}), id: TEST_ID } };
      writeFileSync(join(stage, "manifest.json"), JSON.stringify(manifest, null, 2));
    }
    const dest = out || join(ROOT, "dist", `mousevader-${manifest.version}${test ? "-test" : ""}.xpi`);
    mkdirSync(dirname(dest), { recursive: true });
    rmSync(dest, { force: true });
    execFileSync("zip", ["-qr", "-X", dest, "."], { cwd: stage });
    return dest;
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(build({ test: process.argv.includes("--test") }));
}
