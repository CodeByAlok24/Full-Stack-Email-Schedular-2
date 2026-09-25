const fs = require("node:fs");
const path = require("node:path");

const files = [ ["src", "db", "schema.sql"] ];
for (const parts of files) {
  const src = path.join(__dirname, "..", ...parts);
  const dest = path.join(__dirname, "..", "dist", ...parts.slice(1));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log(`[build] copied ${parts.join("/")} -> dist/${parts.slice(1).join("/")}`);
}
