/**
 * A picked image as a square JPEG (centre-cropped), base64 without the data:
 * prefix. Resizing here keeps a photo upload to a few tens of KB whatever the
 * camera produced, the same as the mobile app does.
 */
export function squareJpegBase64(file, size = 320) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const side = Math.min(img.naturalWidth, img.naturalHeight)
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = size
      canvas.getContext('2d').drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', 0.82).split(',')[1])
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not an image the browser can read')) }
    img.src = url
  })
}

/** Any file as base64 without the data: prefix (document uploads). */
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(new Error('Could not read the file'))
    reader.readAsDataURL(file)
  })
}

/** Largest logo file taken, as on the server. */
export const MAX_LOGO_BYTES = 5 * 1024 * 1024

/**
 * A picked logo as PNG, base64 without the data: prefix: its own shape and
 * transparency kept, the long side brought down to `max` px (never up).
 */
export function logoPngBase64(file, max = 600) {
  if (file.size > MAX_LOGO_BYTES) return Promise.reject(new Error('The logo is too large (max 5 MB)'))
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/png').split(',')[1])
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not an image the browser can read')) }
    img.src = url
  })
}
