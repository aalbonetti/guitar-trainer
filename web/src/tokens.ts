// Embed tokens in lesson markdown: one per line, e.g. {{chord:G_4f}}. Shared by the renderer and the content test.
export const TOKEN_RE = /^\{\{(\w+):([^}]*)\}\}$/;
export function tokenRefs(md: string): { kind: string; arg: string }[] {
  return md.split('\n').map(l => TOKEN_RE.exec(l.trim())).filter(Boolean).map(m => ({ kind: m![1], arg: m![2] }));
}
