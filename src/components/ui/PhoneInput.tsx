'use client';

import { useMemo } from 'react';
import { Input, Select } from './Field';

/**
 * Mobile number with an explicit country code.
 *
 * The stored value is a single string — `+94 771234567` — so nothing
 * downstream has to join two columns. The dial code is kept separate only
 * while someone is typing.
 */

export interface Country {
  code: string;
  dial: string;
  name: string;
}

/** Aahaas operates from Sri Lanka, so LK leads; the rest are the common ones. */
export const COUNTRIES: Country[] = [
  { code: 'LK', dial: '+94', name: 'Sri Lanka' },
  { code: 'IN', dial: '+91', name: 'India' },
  { code: 'AE', dial: '+971', name: 'United Arab Emirates' },
  { code: 'SG', dial: '+65', name: 'Singapore' },
  { code: 'MY', dial: '+60', name: 'Malaysia' },
  { code: 'GB', dial: '+44', name: 'United Kingdom' },
  { code: 'US', dial: '+1', name: 'United States' },
  { code: 'AU', dial: '+61', name: 'Australia' },
  { code: 'QA', dial: '+974', name: 'Qatar' },
  { code: 'SA', dial: '+966', name: 'Saudi Arabia' },
  { code: 'MV', dial: '+960', name: 'Maldives' },
  { code: 'DE', dial: '+49', name: 'Germany' },
  { code: 'FR', dial: '+33', name: 'France' },
  { code: 'CA', dial: '+1', name: 'Canada' },
];

export const DEFAULT_DIAL = COUNTRIES[0].dial;

/** Splits a stored number back into its dial code and the local part. */
export function splitPhone(value: string | null | undefined): { dial: string; local: string } {
  const raw = (value ?? '').trim();
  if (!raw) return { dial: DEFAULT_DIAL, local: '' };
  if (!raw.startsWith('+')) return { dial: DEFAULT_DIAL, local: raw.replace(/\D/g, '') };

  // Longest dial code wins, so +9 never shadows +94.
  const match = [...COUNTRIES]
    .sort((a, b) => b.dial.length - a.dial.length)
    .find((c) => raw.startsWith(c.dial));

  if (!match) return { dial: DEFAULT_DIAL, local: raw.replace(/\D/g, '') };
  return { dial: match.dial, local: raw.slice(match.dial.length).replace(/\D/g, '') };
}

/** Joins the two halves, or returns '' when no number was entered. */
export function joinPhone(dial: string, local: string): string {
  const digits = local.replace(/\D/g, '');
  return digits ? `${dial} ${digits}` : '';
}

export function PhoneInput({
  id,
  value,
  onChange,
  required,
  placeholder = '771234567',
}: {
  id?: string;
  value: string;
  onChange: (next: string) => void;
  required?: boolean;
  placeholder?: string;
}) {
  const { dial, local } = useMemo(() => splitPhone(value), [value]);

  return (
    <div className="flex gap-2">
      <Select
        aria-label="Country code"
        value={dial}
        onChange={(e) => onChange(joinPhone(e.target.value, local))}
        className="!w-[7.5rem] shrink-0"
      >
        {COUNTRIES.map((c) => (
          <option key={c.code} value={c.dial}>
            {c.code} {c.dial}
          </option>
        ))}
      </Select>
      <Input
        id={id}
        type="tel"
        inputMode="numeric"
        required={required}
        value={local}
        placeholder={placeholder}
        maxLength={15}
        onChange={(e) => onChange(joinPhone(dial, e.target.value.replace(/\D/g, '')))}
      />
    </div>
  );
}
