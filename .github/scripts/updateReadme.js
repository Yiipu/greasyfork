const fs = require("fs");
const path = require("path");

const scriptFiles = fs.readdirSync(".").filter(f => f.endsWith(".user.js"));
let entries = [];

for (const file of scriptFiles) {
    const content = fs.readFileSync(file, "utf-8");
    const nameMatch = content.match(/@name\s+(.+)/);
    const descMatch = content.match(/@description\s+(.+)/);

    const name = nameMatch?.[1]?.trim() || file;
    const description = descMatch?.[1]?.trim() || "暂无描述";

    entries.push(`- [**${name}**](${file})：${description}`);
}

const readmePath = path.join("README.md");
let readmeContent = fs.readFileSync(readmePath, "utf-8");

const newSection =
    "<!-- AUTO-SCRIPTS-START -->\n" +
    entries.join("\n") +
    "\n<!-- AUTO-SCRIPTS-END -->";

readmeContent = readmeContent.replace(
    /<!-- AUTO-SCRIPTS-START -->([\s\S]*?)<!-- AUTO-SCRIPTS-END -->/,
    newSection
);

fs.writeFileSync(readmePath, readmeContent, "utf-8");
