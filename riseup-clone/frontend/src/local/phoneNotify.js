/** Optional OS notifications for proactive bot messages (phone mode). */

export const notificationsSupported = () => typeof window !== 'undefined' && 'Notification' in window

export async function requestNotificationPermission() {
  if (!notificationsSupported()) return 'unsupported'
  if (Notification.permission !== 'default') return Notification.permission
  return Notification.requestPermission()
}

const plain = (text) => text.replace(/[*_]/g, '')

/** Show each message as a notification while the app isn't on screen. */
export async function showPhoneNotifications(messages, title) {
  if (!messages.length || !notificationsSupported() || Notification.permission !== 'granted') return
  if (document.visibilityState === 'visible') return
  const registration = await navigator.serviceWorker?.getRegistration()
  for (const m of messages) {
    const [first, ...rest] = plain(m.body).split('\n')
    const options = { body: rest.join('\n') || first, tag: `bot-${m.id}`, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png' }
    if (registration) await registration.showNotification(rest.length ? first : title, options)
    else new Notification(rest.length ? first : title, options)
  }
}
