/**
 * SVG → PNG (512px) + ICO (16/32/48/256px)
 * Usage: node scripts/make-icon.mjs
 */

import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const __dirname = dirname(fileURLToPath(import.meta.url))
const require = createRequire(import.meta.url)

const svgPath = resolve(__dirname, '../app/resources/icon.svg')
const pngPath = resolve(__dirname, '../app/resources/icon.png')
const icoPath = resolve(__dirname, '../app/resources/icon.ico')

// ── 1. SVG → PNG via @resvg/resvg-js ──────────────────────
const { Resvg } = await import('@resvg/resvg-js')

const svgData = readFileSync(svgPath, 'utf-8')
const resvg = new Resvg(svgData, { fitTo: { mode: 'width', value: 512 } })
const pngBuffer = resvg.render().asPng()
writeFileSync(pngPath, pngBuffer)
console.log('✓ icon.png (512×512)')

// ── 2. PNG → ICO via png-to-ico ────────────────────────────
const pngToIco = (await import('png-to-ico')).default

// Generate multiple sizes from the 512px PNG for best ICO quality
const { Resvg: Resvg2 } = await import('@resvg/resvg-js')

async function renderAt(size) {
  const r = new Resvg2(svgData, { fitTo: { mode: 'width', value: size } })
  return Buffer.from(r.render().asPng())
}

const [buf256, buf48, buf32, buf16] = await Promise.all([
  renderAt(256),
  renderAt(48),
  renderAt(32),
  renderAt(16),
])

const icoBuffer = await pngToIco([buf256, buf48, buf32, buf16])
writeFileSync(icoPath, icoBuffer)
console.log('✓ icon.ico (256/48/32/16px)')
console.log('\nDone! Place icon.ico in app/resources/ and restart dev.')
