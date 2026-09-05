// Minimal typings for the node builtins used by the CPython harness test, so the project's
// typecheck stays free of @types/node. Vitest itself runs the file with real Node.
declare module 'node:child_process' {
  export function execFileSync(file: string, args?: readonly string[], options?: { encoding?: string; maxBuffer?: number }): string;
  export function spawnSync(file: string, args?: readonly string[], options?: { encoding?: string }): { status: number | null; stdout: string; stderr: string };
}
declare module 'node:fs' {
  export function writeFileSync(path: string, data: string): void;
  export function mkdtempSync(prefix: string): string;
}
declare module 'node:os' { export function tmpdir(): string; }
declare module 'node:path' { export function join(...parts: string[]): string; }
