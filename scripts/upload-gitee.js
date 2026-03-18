#!/usr/bin/env node
/**
 * 本地上传 release artifact 到 Gitee
 * 用法: node scripts/upload-gitee.js
 * 需要: GITEE_TOKEN 环境变量，或项目根目录 .env 文件中 GITEE_TOKEN=xxx
 */
'use strict'

const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

const ROOT = path.join(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'app/package.json'), 'utf8'))
const VERSION = pkg.version
const TAG = `v${VERSION}`
const OWNER = 'leyradc'
const REPO = 'ai-resource-manager'

console.log(`\n=== Gitee Upload: ${TAG} ===\n`)

// 找 artifact
const distDir = path.join(ROOT, 'app/dist')
let artifact
try {
  const files = fs.readdirSync(distDir).filter(
    f => f.startsWith(`AI-Resource-Manager-${VERSION}-portable-win`) && f.endsWith('.zip')
  )
  if (!files.length) throw new Error()
  artifact = path.join(distDir, files[0])
} catch {
  console.error(`✗ app/dist/ 中未找到 v${VERSION} 的 zip 文件`)
  console.error(`  先执行: cd app && npm run package`)
  process.exit(1)
}
const sizeMB = (fs.statSync(artifact).size / 1024 / 1024).toFixed(1)
console.log(`文件: ${path.basename(artifact)}`)
console.log(`大小: ${sizeMB} MB`)

// 读 token
let token = process.env.GITEE_TOKEN
if (!token) {
  try {
    const env = fs.readFileSync(path.join(ROOT, '.env'), 'utf8')
    token = (env.match(/^GITEE_TOKEN=(.+)/m) || [])[1]?.trim()
  } catch {}
}
if (!token) {
  console.error('\n✗ 未找到 GITEE_TOKEN')
  console.error('  方法1: set GITEE_TOKEN=xxx  (当前终端)')
  console.error('  方法2: 在项目根目录创建 .env 文件，写入 GITEE_TOKEN=xxx')
  process.exit(1)
}
console.log('Token: OK')

// 查询 release ID
console.log(`\n查询 Gitee release ${TAG}...`)
const releaseRes = spawnSync('curl', [
  '-sf',
  `https://gitee.com/api/v5/repos/${OWNER}/${REPO}/releases/tags/${TAG}?access_token=${token}`
], { encoding: 'utf8' })

let releaseId
try {
  const data = JSON.parse(releaseRes.stdout || 'null')
  releaseId = data?.id
} catch {}

if (!releaseId) {
  console.error(`✗ 未找到 Gitee release ${TAG}`)
  console.error(`  请先在 GitHub 发布 release，等 GitHub Actions 在 Gitee 创建好 release 后再运行此脚本`)
  process.exit(1)
}
console.log(`Release ID: ${releaseId}`)

// 上传
console.log('\n上传中...')
const upload = spawnSync('curl', [
  '-#', '-X', 'POST',
  `https://gitee.com/api/v5/repos/${OWNER}/${REPO}/releases/${releaseId}/attach_files`,
  '-F', `access_token=${token}`,
  '-F', `file=@${artifact}`
], { stdio: 'inherit' })

if (upload.status !== 0) {
  console.error('\n✗ 上传失败')
  process.exit(1)
}

console.log(`\n✓ 完成！`)
console.log(`  下载页: https://gitee.com/${OWNER}/${REPO}/releases/tag/${TAG}`)
