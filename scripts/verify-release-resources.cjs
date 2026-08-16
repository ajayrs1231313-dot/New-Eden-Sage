const { existsSync, statSync } = require("node:fs");
const { join } = require("node:path");

const required = join(__dirname, "..", "vendor", "tunnel-client", "tunnel-client.exe");
if (!existsSync(required) || statSync(required).size === 0) {
  throw new Error(`Release resource missing: ${required}`);
}
console.log("Release resources verified.");
