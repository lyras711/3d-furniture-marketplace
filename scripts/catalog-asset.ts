export function validateGlb(data: string, maxBytes = 18 * 1024 * 1024) {
  if (!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) throw new Error('Upload a valid binary GLB file.')
  const bytes = Buffer.from(data, 'base64')
  if (bytes.length < 20 || bytes.length > maxBytes || bytes.toString('base64') !== data || bytes.toString('ascii', 0, 4) !== 'glTF' || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) throw new Error(`GLB file is invalid or larger than ${Math.floor(maxBytes / 1024 / 1024)} MB.`)
  let offset = 12, json: Record<string, unknown> | null = null
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) throw new Error('GLB chunk header is incomplete.')
    const length = bytes.readUInt32LE(offset), type = bytes.readUInt32LE(offset + 4), start = offset + 8, end = start + length
    if (length % 4 || end > bytes.length) throw new Error('GLB chunk length is invalid.')
    if (offset === 12) {
      if (type !== 0x4e4f534a) throw new Error('GLB must start with a JSON chunk.')
      try { json = JSON.parse(bytes.toString('utf8', start, end).trim()) as Record<string, unknown> } catch { throw new Error('GLB JSON chunk is invalid.') }
    }
    offset = end
  }
  const asset = json?.asset as { version?: unknown } | undefined
  if (offset !== bytes.length || asset?.version !== '2.0') throw new Error('GLB must contain a valid 2.0 asset declaration.')
  return bytes
}

export function validateTexture(data: string, mimeType: string, maxBytes = 10 * 1024 * 1024) {
  if (!/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) throw new Error('Upload a valid PNG, JPEG, or WebP texture.')
  const ext = ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' } as Record<string, string>)[mimeType]
  if (!ext) throw new Error('Texture must be a PNG, JPEG, or WebP image.')
  const bytes = Buffer.from(data, 'base64')
  const valid = mimeType === 'image/png'
    ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    : mimeType === 'image/jpeg'
      ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
  if (!valid || !bytes.length || bytes.length > maxBytes || bytes.toString('base64') !== data) throw new Error(`Texture is invalid or larger than ${Math.floor(maxBytes / 1024 / 1024)} MB.`)
  return { bytes, ext }
}
