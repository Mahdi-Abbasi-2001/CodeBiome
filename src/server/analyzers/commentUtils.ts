/**
 * Strips comments before any analyzer runs its import regex over a file's
 * content — without this, a commented-out `// import { x } from './y'` or
 * `# from foo import bar` matches exactly like a real one and produces a
 * fabricated dependency edge.
 *
 * Deliberately conservative: only WHOLE lines that are entirely a comment
 * (after trimming leading whitespace) are removed, plus `/* *\/`-style block
 * comments. A trailing comment on a code line (`const x = 1; // see ./y`) is
 * left alone — correctly telling that apart from a `//` embedded in a string
 * literal needs a real tokenizer, which none of these regex-based analyzers
 * otherwise attempt. The common real-world shape of a commented-out
 * import/require/use statement is a whole line, so that's what this covers.
 */
export function stripLineComments(content: string, style: "slash" | "hash" | "both"): string {
  const lines = content.split("\n");
  return lines
    .map((line) => {
      const trimmed = line.trimStart();
      if (style !== "hash" && trimmed.startsWith("//")) return "";
      if (style !== "slash" && trimmed.startsWith("#")) return "";
      return line;
    })
    .join("\n");
}

/** `/* ... *\/` block comments — safe to remove even mid-line since a real
 *  import/require statement never legitimately spans into one. */
export function stripBlockComments(content: string): string {
  return content.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** For C-like languages (JS/TS, Java, C#, C/C++, Rust, Go): `//` lines + `/* *\/` blocks. */
export function stripCLikeComments(content: string): string {
  return stripBlockComments(stripLineComments(content, "slash"));
}
