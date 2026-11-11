// The few Node APIs core uses, so `tsc` type-checks without installing @types/node. A build that
// brings @types/node (the desktop app) excludes this file instead of declaring the modules twice.
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
// For core's tests, which run under `orca plugin test` and `node --test 'core/*.test.ts'`.
declare module 'node:test' {
  export function test(name: string, fn: () => unknown): Promise<void>
}
declare module 'node:assert/strict' {
  const assert: {
    ok(value: unknown, message?: string): asserts value
    equal<T>(actual: unknown, expected: T, message?: string): asserts actual is T
    deepEqual<T>(actual: unknown, expected: T, message?: string): asserts actual is T
    match(value: string, pattern: RegExp, message?: string): void
    rejects(promise: Promise<unknown>, error?: RegExp | Error, message?: string): Promise<void>
  }
  export default assert
}
declare const process: { env: Record<string, string | undefined> }
