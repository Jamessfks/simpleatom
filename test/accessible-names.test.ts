import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// D126: a tab list or a radio group with no accessible name is announced as
// "tab list" / "radio group" with nothing to say what it chooses between.
// Every <TabsList> and <RadioGroup> outside components/ui must be labelled.

function tsx(dir: string): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".tsx"))
    .map((e) => join(e.parentPath, e.name))
    .filter((p) => !p.startsWith("components/ui"));
}

/** The opening tag starting at `start` (JSX braces may hold `=>`), through its closing `>`. */
function openingTag(source: string, start: number): string {
  let depth = 0;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return source.slice(start, i + 1);
  }
  return source.slice(start);
}

const tags: { file: string; tag: string }[] = [];
for (const file of [...tsx("app"), ...tsx("components")]) {
  const source = readFileSync(file, "utf8");
  for (const m of source.matchAll(/<(TabsList|RadioGroup)\b/g)) {
    tags.push({ file, tag: openingTag(source, m.index!) });
  }
}

describe("tab lists and radio groups are named (D126)", () => {
  it("finds the groups it is meant to check", () => {
    expect(tags.length).toBeGreaterThanOrEqual(5);
  });

  for (const { file, tag } of tags) {
    it(`${file}: ${tag.slice(0, 24).replace(/\s+/g, " ")}`, () => {
      expect(tag).toMatch(/aria-label(?:ledby)?=/);
    });
  }
});
