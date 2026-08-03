const fs = require("node:fs/promises");
const path = require("node:path");
const sharp = require("sharp");

async function main() {
  const source = path.join(__dirname, "..", "build", "icon.svg");
  const destination = path.join(__dirname, "..", "build", "icon.png");
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await sharp(source).resize(512, 512).png().toFile(destination);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
