// 生成 Chrome 扩展打包用的测试私钥（.pem），并算出对应的扩展 ID
// 用法:  node make-test-key.mjs [输出路径，默认 debug-extension.pem]
// 说明:
//   - 扩展 ID 由公钥 SHA256 派生 → 同一把私钥永远得到同一个扩展 ID
//   - 文件已存在时拒绝覆盖（防止误删导致 ID 变化），要换 ID 请先手动删除旧 .pem
//   ⚠️ 仅用于本地测试。正式发布请用 Chrome「打包扩展程序」生成的密钥并妥善保管，
//      泄露私钥 = 任何人可向该扩展 ID 推送更新。
import { generateKeyPairSync, createHash, createPublicKey } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const out = join(dirname(fileURLToPath(import.meta.url)), process.argv[2] || 'debug-extension.pem')

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
	modulusLength: 2048,
	publicKeyEncoding: { type: 'spki', format: 'pem' },
	privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})

try {
	writeFileSync(out, privateKey, { flag: 'wx' })
} catch {
	console.error(`已存在 ${out}，拒绝覆盖（同一密钥=同一扩展ID）。要换新 ID 请先手动删除。`)
	process.exit(1)
}

const der = createPublicKey(publicKey).export({ type: 'spki', format: 'der' })
const hash = createHash('sha256').update(der).digest('hex')
const id = [...hash.slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('')

console.log(`私钥已生成: ${out}`)
console.log(`对应扩展 ID: ${id}`)
