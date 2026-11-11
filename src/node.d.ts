// The few Node APIs the worker uses, so `tsc` type-checks without installing @types/node.
declare module 'node:child_process' {
  export function execFile(
    file: string,
    args: readonly string[],
    options: { cwd?: string; timeout?: number; maxBuffer?: number; env?: Record<string, string | undefined> },
    callback: (error: (Error & { code?: number | string }) | null, stdout: string, stderr: string) => void
  ): unknown
}
declare module 'node:fs' {
  export function existsSync(path: string): boolean
}
declare module 'node:os' {
  export function homedir(): string
}
declare module 'node:path' {
  export function join(...parts: string[]): string
}
declare const process: { env: Record<string, string | undefined> }
