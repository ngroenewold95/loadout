/**
 * Render the launcher icon from its geometry, straight to PNG.
 *
 * There is no rasteriser on this machine - no ImageMagick, no Inkscape, no
 * sharp - and adding one for a shape made of five rectangles would be a
 * dependency to maintain forever. Node ships `zlib`, a PNG is a zlib stream
 * with a header, and the mark is rectangles at 45 degrees, so this file is the
 * whole toolchain.
 *
 * The source of truth is `design/icons/e12-e8-longest-bar.svg`; the geometry
 * below is that file's, restated in numbers. Change one and change the other.
 *
 * Usage: node scripts/make-icons.mjs
 *
 * What it writes, into `android/app/src/main/res/`:
 *
 * - `ic_launcher_foreground.png` in every `mipmap-` density - the art alone on
 *   transparency, at
 *   108 dp, which is what the adaptive icon composites over the background
 *   colour in `values/ic_launcher_background.xml`.
 * - `ic_launcher.png` and `ic_launcher_round.png` - the legacy icons
 *   for API 24 and 25, which this app still supports (`minSdkVersion = 24`).
 *   Those launchers do no masking of their own, so the corners are rounded
 *   here and the round one is cut to a circle.
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RES = join(dirname(fileURLToPath(import.meta.url)), '..', 'android', 'app', 'src', 'main', 'res')

/** The adaptive canvas is 108 dp and the safe circle is the middle 72. */
const CANVAS = 108
const CENTER = CANVAS / 2

const FOREGROUND = [180, 197, 255] // #b4c5ff
const BACKGROUND = [0, 42, 119] // #002a77

/** Rotation of the whole mark, matching the Capacitor mark it replaces. */
const ANGLE = -45

/** `e12`: a long bar, heavy plates, softened corners. x, y, width, height, radius. */
const SHAPES = [
  [20, 49, 68, 10, 3],
  [28, 32, 15, 44, 4],
  [65, 32, 15, 44, 4],
]

/**
 * Densities, as a multiplier on the baseline. The foreground is authored at
 * 108 dp and the legacy icon at 48, so each gets its own baseline.
 */
const DENSITIES = [
  ['mdpi', 1],
  ['hdpi', 1.5],
  ['xhdpi', 2],
  ['xxhdpi', 3],
  ['xxxhdpi', 4],
]

/** Supersampling. Nine samples a pixel is enough for edges at 45 degrees. */
const SS = 3

/** Is this point inside the rounded rectangle? */
function inRect(px, py, [x, y, w, h, r]) {
  if (px < x || px > x + w || py < y || py > y + h) return false
  // Only the four corner boxes need the distance test; everything else is in.
  const cx = px < x + r ? x + r : px > x + w - r ? x + w - r : px
  const cy = py < y + r ? y + r : py > y + h - r ? y + h - r : py
  if (cx === px && cy === py) return true
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r
}

/** Coverage at a point in canvas space, 0 or 1. Anti-aliasing is the caller's. */
function covers(px, py) {
  // Undo the group rotation rather than rotating every rectangle: one inverse
  // transform, then plain axis-aligned tests.
  const rad = (-ANGLE * Math.PI) / 180
  const dx = px - CENTER
  const dy = py - CENTER
  const rx = CENTER + dx * Math.cos(rad) - dy * Math.sin(rad)
  const ry = CENTER + dx * Math.sin(rad) + dy * Math.cos(rad)
  return SHAPES.some((shape) => inRect(rx, ry, shape)) ? 1 : 0
}

/**
 * Render to RGBA.
 *
 * `zoom` maps the canvas into the image: 1 shows the whole 108 dp square, and
 * 108/72 shows only the safe circle's square, which is how a legacy icon is
 * cut from an adaptive one.
 *
 * `mask` is `null` (square), `'round'` (the legacy rounded square) or
 * `'circle'`.
 */
function render(size, { zoom = 1, background = null, mask = null } = {}) {
  const pixels = Buffer.alloc(size * size * 4)
  const span = CANVAS / zoom
  const origin = (CANVAS - span) / 2
  const radius = size * 0.2

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let art = 0
      let inside = 0

      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const fx = px + (sx + 0.5) / SS
          const fy = py + (sy + 0.5) / SS
          art += covers(origin + (fx / size) * span, origin + (fy / size) * span)
          inside += inMask(fx, fy, size, radius, mask)
        }
      }

      const samples = SS * SS
      const artAlpha = art / samples
      const maskAlpha = inside / samples
      const i = (py * size + px) * 4

      if (background) {
        // The art sits on the background, and the mask cuts both at once.
        for (let c = 0; c < 3; c++) {
          pixels[i + c] = Math.round(
            BACKGROUND[c] * (1 - artAlpha) + FOREGROUND[c] * artAlpha,
          )
        }
        pixels[i + 3] = Math.round(255 * maskAlpha)
      } else {
        // Foreground only: colour everywhere, alpha carries the shape, so
        // scaling never bleeds the background colour into the edges.
        for (let c = 0; c < 3; c++) pixels[i + c] = FOREGROUND[c]
        pixels[i + 3] = Math.round(255 * artAlpha * maskAlpha)
      }
    }
  }

  return pixels
}

function inMask(fx, fy, size, radius, mask) {
  if (mask === null) return 1
  if (mask === 'circle') {
    const dx = fx - size / 2
    const dy = fy - size / 2
    return dx * dx + dy * dy <= (size / 2) ** 2 ? 1 : 0
  }
  return inRect(fx, fy, [0, 0, size, size, radius]) ? 1 : 0
}

/** PNG: signature, IHDR, one IDAT of zlib-deflated filtered rows, IEND. */
function png(size, pixels) {
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0 // filter type 0, "None"
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([length, body, crc])
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buffer) {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function write(density, name, size, options) {
  const dir = join(RES, `mipmap-${density}`)
  mkdirSync(dir, { recursive: true })
  const file = join(dir, name)
  writeFileSync(file, png(size, render(size, options)))
  console.log(`${density.padEnd(8)} ${name.padEnd(26)} ${size}px`)
}

for (const [density, scale] of DENSITIES) {
  // The adaptive foreground is the full 108 dp canvas: the launcher does the
  // masking, and cropping here would defeat the safe circle.
  write(density, 'ic_launcher_foreground.png', Math.round(108 * scale), {})

  // Legacy, API 24 and 25. Zoomed to the safe square, the way an adaptive icon
  // is cut down, and masked here because those launchers mask nothing.
  const legacy = Math.round(48 * scale)
  write(density, 'ic_launcher.png', legacy, {
    zoom: 108 / 72,
    background: true,
    mask: 'round',
  })
  write(density, 'ic_launcher_round.png', legacy, {
    zoom: 108 / 72,
    background: true,
    mask: 'circle',
  })
}
