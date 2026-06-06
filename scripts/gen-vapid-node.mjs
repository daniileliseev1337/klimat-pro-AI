// Генерация VAPID-ключей локально через встроенный Node Web Crypto (без внешних
// пакетов / jsr / прокси). Формат под @negrel/webpush importVapidKeys (JWK-пара)
// + raw base64url public для фронта (applicationServerKey).
// Запуск: node scripts/gen-vapid-node.mjs
import { webcrypto as crypto } from 'node:crypto'
const { subtle } = crypto

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
const publicKey = await subtle.exportKey('jwk', pair.publicKey)
const privateKey = await subtle.exportKey('jwk', pair.privateKey)
const rawPub = await subtle.exportKey('raw', pair.publicKey) // 65 байт uncompressed

console.log(
  JSON.stringify(
    {
      publicKeyBase64Url: b64url(rawPub),
      vapidKeys: { publicKey, privateKey },
    },
    null,
    2
  )
)
