/** Keep the LAN demo exemption on one host; all other hosts require HTTPS. */
const { withAndroidManifest, withDangerousMod, AndroidConfig } = require('expo/config-plugins')
const fs = require('node:fs/promises')
const path = require('node:path')

function networkSecurityXml(base) {
  const url = base ? new URL(base) : null
  if (url && !['http:', 'https:'].includes(url.protocol)) throw new Error('API URL must use HTTP or HTTPS')
  let exception = ''
  if (url?.protocol === 'http:') {
    const octets = url.hostname.split('.').map(Number)
    const privateAddress = octets.length === 4 && octets.every(n => Number.isInteger(n) && n >= 0 && n <= 255) &&
      // 127.x is the phone's own loopback, which `adb reverse` forwards over USB - the LAN-free demo path.
      (octets[0] === 10 || octets[0] === 127 || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) || (octets[0] === 192 && octets[1] === 168))
    if (!privateAddress || url.username || url.password) throw new Error('Plain HTTP is permitted only for a private LAN demo IP')
    exception = `\n  <domain-config cleartextTrafficPermitted="true"><domain includeSubdomains="false">${url.hostname}</domain></domain-config>`
  }
  return `<?xml version="1.0" encoding="utf-8"?>\n<network-security-config>\n  <base-config cleartextTrafficPermitted="false" />${exception}\n</network-security-config>\n`
}

module.exports = function withDemoNetworkSecurity(config, { base = '' } = {}) {
  const xml = networkSecurityXml(base)
  config = withAndroidManifest(config, mod => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(mod.modResults)
    application.$['android:usesCleartextTraffic'] = 'false'
    application.$['android:networkSecurityConfig'] = '@xml/ner_network_security_config'
    return mod
  })
  return withDangerousMod(config, ['android', async mod => {
    const directory = path.join(mod.modRequest.platformProjectRoot, 'app/src/main/res/xml')
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(path.join(directory, 'ner_network_security_config.xml'), xml)
    return mod
  }])
}
module.exports.networkSecurityXml = networkSecurityXml
