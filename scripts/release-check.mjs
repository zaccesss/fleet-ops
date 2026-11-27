// checks a release tag against the repository and prints its changelog section.
// usage: node scripts/release-check.mjs v1.1.0 [notes-file]
// every package.json, the Python project and the changelog must agree with the tag, so a release
// can never ship with one part still on the previous version.

import { readFileSync, writeFileSync } from "node:fs";

const tag = process.argv[2] ?? "";
const notesFile = process.argv[3];
const match = /^v(\d+\.\d+\.\d+)$/.exec(tag);
if (!match) {
  console.error(`"${tag}" is not a release tag like v1.2.3`);
  process.exit(1);
}
const version = match[1];

const manifests = [
  "package.json",
  "packages/core/package.json",
  "packages/chatops/package.json",
  "workers/scheduler/package.json",
  "workers/governance/package.json",
];
const problems = [];
for (const file of manifests) {
  const found = JSON.parse(readFileSync(file, "utf8")).version;
  if (found !== version) problems.push(`${file} is ${found}`);
}
const python = /^version = "([^"]+)"/m.exec(readFileSync("python/pyproject.toml", "utf8"))?.[1];
if (python !== version) problems.push(`python/pyproject.toml is ${python}`);

const changelog = readFileSync("CHANGELOG.md", "utf8");
const start = changelog.indexOf(`## [${version}]`);
if (start === -1) problems.push(`CHANGELOG.md has no section for ${version}`);

if (problems.length) {
  console.error(`${tag} does not match the repository:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}

// the section runs from its heading to the next version heading or the link list at the end
const body = changelog.slice(changelog.indexOf("\n", start) + 1);
const end = body.search(/^## \[|^\[\d+\.\d+\.\d+\]:/m);
const notes = (end === -1 ? body : body.slice(0, end)).trim();
if (notesFile) writeFileSync(notesFile, `${notes}\n`);
console.log(`${tag} matches every manifest and the changelog`);
