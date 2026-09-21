const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SOURCE_ROOTS = ["src", "electron", path.join("backend", "src"), path.join("tools", "modal")];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".css", ".mjs", ".cjs", ".py", ".md"]);
const suspiciousMarkers = [
  String.fromCharCode(0x00c3),
  String.fromCharCode(0x00c2),
  String.fromCharCode(0xfffd),
  String.fromCharCode(0x251c),
  String.fromCharCode(0x252c),
  String.fromCharCode(0x00e2, 0x20ac),
];

function walk(directory, files = []) {
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "__pycache__" || entry.name === "dist") continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(full);
  }
  return files;
}

test("app source is free of common mojibake/encoding artifacts", () => {
  const hits = [];
  for (const relativeRoot of SOURCE_ROOTS) {
    for (const file of walk(path.join(ROOT, relativeRoot))) {
      const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
      lines.forEach((line, index) => {
        if (suspiciousMarkers.some((marker) => line.includes(marker))) {
          hits.push(`${path.relative(ROOT, file)}:${index + 1}: ${line.trim().slice(0, 180)}`);
        }
      });
    }
  }
  assert.deepEqual(hits, [], `Mojibake artifacts found:\n${hits.join("\n")}`);
});
