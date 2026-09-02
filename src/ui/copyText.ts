/**
 * Put text on the clipboard, from a WebView, with no plugin.
 *
 * `@capacitor/clipboard` exists and would be one more dependency plus a native
 * sync for something the browser already does: Capacitor serves the app from
 * `https://localhost`, which is a secure context, so the async Clipboard API is
 * available. It is still gated on a user gesture and on a permission the
 * WebView can refuse, so the older `execCommand('copy')` path stays as the
 * fallback rather than being trusted to be dead.
 *
 * Returns whether the text actually landed, so the caller can say `Copied`
 * only when it is true.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Refused or unavailable - fall through to the older path rather than
    // failing, which is the whole reason there are two.
  }

  return legacyCopy(text)
}

/**
 * The pre-Clipboard-API way: a selection inside a textarea, then `copy`.
 *
 * Off-screen rather than hidden. `display: none` and `visibility: hidden`
 * elements cannot hold a selection, so the copy would silently take nothing.
 */
function legacyCopy(text: string): boolean {
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.top = '-1000px'
  area.style.opacity = '0'
  document.body.appendChild(area)

  try {
    area.select()
    area.setSelectionRange(0, text.length)
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    document.body.removeChild(area)
  }
}
