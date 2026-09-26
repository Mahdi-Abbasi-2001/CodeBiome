/**
 * A small regex tokenizer — not a real parser — that approximates the
 * syntax coloring from the CodeBiome design (keyword=amber, type/class=teal,
 * string/comment=muted tones). Deliberately not a dependency (Shiki/Prism)
 * to keep the bundle light for a hackathon build; good enough for showing
 * real repository source with the right visual language.
 */

export interface CodeToken {
  text: string;
  color: string;
}

const KEYWORD_COLOR = "#F2B84B";
const TYPE_COLOR = "#4FD1C5";
const STRING_COLOR = "#9C9A92";
const COMMENT_COLOR = "#6B7580";
const DEFAULT_COLOR = "#D8DBDE";

const KEYWORDS = new Set([
  "export", "import", "from", "default", "const", "let", "var", "function", "class", "extends",
  "implements", "interface", "type", "return", "if", "else", "for", "while", "do", "switch", "case",
  "break", "continue", "new", "this", "super", "async", "await", "try", "catch", "finally", "throw",
  "public", "private", "protected", "readonly", "static", "of", "in", "instanceof", "typeof", "void",
  "null", "undefined", "true", "false", "def", "self", "elif", "pass", "lambda", "with", "as",
]);

const TOKEN_PATTERN =
  /(\/\/[^\n]*)|(\/\*[\s\S]*?\*\/)|(#[^\n]*)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b[A-Z][A-Za-z0-9_]*\b)|(\b[a-zA-Z_$][a-zA-Z0-9_$]*\b)|(\d+)/g;

function tokenizeLine(line: string): CodeToken[] {
  const tokens: CodeToken[] = [];
  let lastIndex = 0;
  for (const match of line.matchAll(TOKEN_PATTERN)) {
    if (match.index === undefined) continue;
    if (match.index > lastIndex) {
      tokens.push({ text: line.slice(lastIndex, match.index), color: DEFAULT_COLOR });
    }
    const [full, lineComment, blockComment, hashComment, str, capitalized, identifier] = match;
    if (lineComment || blockComment || hashComment) {
      tokens.push({ text: full, color: COMMENT_COLOR });
    } else if (str) {
      tokens.push({ text: full, color: STRING_COLOR });
    } else if (capitalized) {
      tokens.push({ text: full, color: TYPE_COLOR });
    } else if (identifier && KEYWORDS.has(identifier)) {
      tokens.push({ text: full, color: KEYWORD_COLOR });
    } else {
      tokens.push({ text: full, color: DEFAULT_COLOR });
    }
    lastIndex = match.index + full.length;
  }
  if (lastIndex < line.length) tokens.push({ text: line.slice(lastIndex), color: DEFAULT_COLOR });
  return tokens;
}

export function highlightCode(source: string): CodeToken[][] {
  return source.replace(/\n$/, "").split("\n").map(tokenizeLine);
}
