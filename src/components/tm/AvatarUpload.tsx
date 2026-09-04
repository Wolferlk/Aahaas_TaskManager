'use client';

import { useRef, useState } from 'react';
import { Camera, Trash2, Loader2 } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { useToast } from '@/components/ui/Toast';
import { ApiClientError } from '@/lib/client';

/**
 * Profile photo picker. Shows an instant local preview while the upload runs,
 * then swaps to the stored URL so the rest of the app picks it up.
 */
export function AvatarUpload({
  name,
  src,
  onChanged,
}: {
  name: string;
  src: string | null;
  onChanged: (url: string | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const upload = async (file: File) => {
    setPreview(URL.createObjectURL(file));
    setBusy(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/tm/users/avatar', { method: 'POST', body: form, credentials: 'same-origin' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiClientError(res.status, json.error ?? 'Upload failed.');

      onChanged(json.avatar_url);
      toast({ kind: 'success', title: 'Profile photo updated' });
    } catch (err) {
      setPreview(null);
      toast({ kind: 'error', title: err instanceof ApiClientError ? err.message : 'Could not upload that image.' });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const res = await fetch('/api/tm/users/avatar', { method: 'DELETE', credentials: 'same-origin' });
      if (!res.ok) throw new ApiClientError(res.status, 'Could not remove the photo.');
      setPreview(null);
      onChanged(null);
      toast({ kind: 'success', title: 'Profile photo removed' });
    } catch (err) {
      toast({ kind: 'error', title: err instanceof ApiClientError ? err.message : 'Could not remove the photo.' });
    } finally {
      setBusy(false);
    }
  };

  const shown = preview ?? src;

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="relative">
        <Avatar name={name} src={shown} size="xl" />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="focus-ring absolute -bottom-1 -right-1 flex h-8 w-8 items-center justify-center rounded-full bg-brand text-brand-ink shadow-pop transition-transform hover:scale-105 disabled:opacity-60"
          aria-label="Change profile photo"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
        </button>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className="text-xs font-medium text-brand hover:underline disabled:opacity-50"
        >
          {shown ? 'Change photo' : 'Upload photo'}
        </button>
        {shown && (
          <button
            type="button"
            onClick={remove}
            disabled={busy}
            className="flex items-center gap-1 text-xs text-faint hover:text-red-500 disabled:opacity-50"
          >
            <Trash2 className="h-3 w-3" /> Remove
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) upload(file);
          e.target.value = '';
        }}
      />
      <p className="text-[11px] text-faint">PNG, JPG, WEBP or GIF · max 4MB</p>
    </div>
  );
}
