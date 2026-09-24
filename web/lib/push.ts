import { api } from '@/lib/api';

export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const registration = () => navigator.serviceWorker.register('/sw.js');

export async function currentSubscription() {
  return (await registration()).pushManager.getSubscription();
}

/** Asks permission, subscribes this browser and registers it with the API. */
export async function enablePush(vapidPublicKey: string) {
  if ((await Notification.requestPermission()) !== 'granted')
    throw new Error('Bạn đã chặn thông báo trong trình duyệt.');
  const sub = await (await registration()).pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: Uint8Array.fromBase64(vapidPublicKey, { alphabet: 'base64url' }),
  });
  const { endpoint, keys } = sub.toJSON();
  if (!endpoint || !keys?.p256dh || !keys.auth) throw new Error('Trình duyệt không trả về subscription hợp lệ.');
  await api.push.subscriptions.$post({ json: { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } } });
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await api.push.subscriptions.$delete({ json: { endpoint: sub.endpoint } });
  await sub.unsubscribe();
}
