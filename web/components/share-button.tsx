import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { errorMessage } from '@/lib/errors';

type Props = {
  label: string;
  description: string;
  /** Current token, or null when not shared. */
  token: string | null;
  /** Public page path for a token, e.g. `/share/t/abc`. */
  pathFor: (token: string) => string;
  share: () => Promise<{ token: string | null }>;
  revoke: () => Promise<unknown>;
  onChange: () => void;
};

/** Opens a dialog with the public link; creates it on first open, can revoke it. */
export function ShareButton({ label, description, token, pathFor, share, revoke, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const create = useMutation({ mutationFn: share, onSuccess: onChange, onError: (e) => toast.error(errorMessage(e)) });
  const remove = useMutation({
    mutationFn: revoke,
    onSuccess: () => {
      onChange();
      setOpen(false);
      toast.success('Đã thu hồi link');
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const current = create.data?.token ?? token;
  const url = current ? `${location.origin}${pathFor(current)}` : null;

  function show() {
    setOpen(true);
    if (!token) create.mutate();
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={show}>
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{label}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          {url && <code className="block break-all rounded bg-muted px-2 py-1.5 text-xs">{url}</code>}
          <div className="flex gap-2">
            <Button
              disabled={!url}
              onClick={() => url && navigator.clipboard.writeText(url).then(() => toast.success('Đã copy link'))}
            >
              Copy link
            </Button>
            <Button variant="destructive" disabled={!url || remove.isPending} onClick={() => remove.mutate()}>
              Thu hồi
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
