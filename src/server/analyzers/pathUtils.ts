/**
 * Shared by every language-specific dependency analyzer. Previously
 * copy-pasted verbatim into five separate analyzer files.
 */
export function posixJoin(base: string, relative: string): string {
  const parts = (base ? base.split("/") : []).concat(relative.split("/"));
  const stack: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return stack.join("/");
}
