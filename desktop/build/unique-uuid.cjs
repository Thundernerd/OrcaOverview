// electron-builder afterPack hook: gives the app's executable its own Mach-O UUID.
// Every Electron app ships the same launcher binary, so its LC_UUID is Electron's. macOS's Local
// Network privacy looks the app up by that UUID, finds com.github.Electron (for example the copy
// in node_modules) instead of this app, and blocks paired servers without ever asking. Runs
// before signing, so the signature covers the new UUID.
const { createHash } = require('node:crypto')
const { readFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const LC_UUID = 0x1b
const MH_MAGIC_64 = 0xfeedfacf
const FAT_MAGIC = 0xcafebabe

/** Replaces the LC_UUID of the 64-bit slice at `offset` with one derived from `seed`. */
function rewriteSlice(buf, offset, seed) {
  if (buf.readUInt32LE(offset) !== MH_MAGIC_64) throw new Error('not a 64-bit Mach-O slice')
  const cputype = buf.readUInt32LE(offset + 4)
  const ncmds = buf.readUInt32LE(offset + 16)
  let cmd = offset + 32
  for (let i = 0; i < ncmds; i++) {
    if (buf.readUInt32LE(cmd) === LC_UUID) {
      const uuid = createHash('sha256').update(`${seed}:${cputype}`).digest().subarray(0, 16)
      uuid[6] = (uuid[6] & 0x0f) | 0x50 // version 5 (name-based)
      uuid[8] = (uuid[8] & 0x3f) | 0x80 // RFC 4122 variant
      uuid.copy(buf, cmd + 8)
      return
    }
    cmd += buf.readUInt32LE(cmd + 4)
  }
  throw new Error('no LC_UUID load command')
}

exports.default = async function uniqueUuid(context) {
  if (context.electronPlatformName !== 'darwin') return
  const { productFilename, info } = context.packager.appInfo
  const exe = join(context.appOutDir, `${productFilename}.app`, 'Contents', 'MacOS', productFilename)
  const buf = readFileSync(exe)
  if (buf.readUInt32BE(0) === FAT_MAGIC) {
    for (let i = 0, n = buf.readUInt32BE(4); i < n; i++) rewriteSlice(buf, buf.readUInt32BE(8 + i * 20 + 8), info.id)
  } else rewriteSlice(buf, 0, info.id)
  writeFileSync(exe, buf)
}
