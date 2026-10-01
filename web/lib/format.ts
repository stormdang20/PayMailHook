const dateTime = new Intl.DateTimeFormat('vi-VN', {
  timeZone: 'Asia/Ho_Chi_Minh',
  dateStyle: 'short',
  timeStyle: 'medium',
});

export { formatMoney } from '../../src/core/text';
export const formatTime = (iso: string | null) => (iso ? dateTime.format(new Date(iso)) : '—');

export function timeAgo(iso: string | null) {
  if (!iso) return null;
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return 'vừa xong';
  if (minutes < 60) return `${minutes} phút trước`;
  if (minutes < 60 * 24) return `${Math.round(minutes / 60)} giờ trước`;
  return `${Math.round(minutes / 60 / 24)} ngày trước`;
}
