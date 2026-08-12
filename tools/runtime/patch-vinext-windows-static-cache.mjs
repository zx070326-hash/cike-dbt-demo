import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const target = path.resolve(
  projectDir,
  "node_modules",
  "vinext",
  "dist",
  "server",
  "static-file-cache.js",
);

const windowsUnsafe = "relativePath: path.relative(base, batch[j]),";
const windowsSafe =
  'relativePath: path.relative(base, batch[j]).split(path.sep).join("/"),';

const source = fs.readFileSync(target, "utf8");

if (source.includes(windowsSafe)) {
  process.exit(0);
}

if (!source.includes(windowsUnsafe)) {
  throw new Error(
    "The installed vinext static-file-cache implementation no longer matches the expected patch target.",
  );
}

fs.writeFileSync(target, source.replace(windowsUnsafe, windowsSafe), "utf8");
console.log("Applied the vinext Windows static-asset path compatibility patch.");
