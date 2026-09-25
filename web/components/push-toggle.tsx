import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { api, parseResponse } from '@/lib/api';
import { currentSubscription, disablePush, enablePush, pushSupported } from '@/lib/push';

/** "Notify me of incoming money" for this browser; hidden when the server or browser has no Web Push. */
export function PushToggle() {
  const queryClient = useQueryClient();
  const { data: server } = useQuery({ queryKey: ['config'], queryFn: () => parseResponse(api.config.$get()) });
  const vapidKey = server?.vapidPublicKey;
  const subscribed = useQuery({
    queryKey: ['push-subscription'],
    enabled: Boolean(vapidKey) && pushSupported(),
    queryFn: async () => Boolean(await currentSubscription()),
  });
  const toggle = useMutation({
    mutationFn: () => (subscribed.data ? disablePush() : enablePush(vapidKey ?? '')),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['push-subscription'] });
      toast.success(subscribed.data ? 'Đã tắt thông báo' : 'Sẽ thông báo khi có tiền vào');
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : 'Không bật được thông báo'),
  });
  if (!vapidKey || !pushSupported() || subscribed.data === undefined) return null;
  const label = subscribed.data ? 'Tắt thông báo tiền vào' : 'Bật thông báo tiền vào';
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={label}
      title={label}
      aria-pressed={subscribed.data}
      onClick={() => toggle.mutate()}
      disabled={toggle.isPending}
    >
      {subscribed.data ? <Bell className="text-primary" /> : <BellOff />}
    </Button>
  );
}
