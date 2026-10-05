'use client';

import { useEffect, useState } from 'react';

/** The current time, refreshed every `intervalMs`, for labels like "Due in 3h". */
export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
