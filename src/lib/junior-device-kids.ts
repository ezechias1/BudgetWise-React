const STORAGE_KEY = 'budgetwise-junior-device-kids';

export interface DeviceKid {
  memberId: string;
  name: string;
  color: string;
  lastSignedIn: string; // ISO
}

export function listDeviceKids(): DeviceKid[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as DeviceKid[];
    if (!Array.isArray(arr)) return [];
    // Most-recent first
    return arr.sort((a, b) => b.lastSignedIn.localeCompare(a.lastSignedIn));
  } catch {
    return [];
  }
}

export function rememberDeviceKid(kid: Omit<DeviceKid, 'lastSignedIn'>): void {
  const existing = listDeviceKids().filter((k) => k.memberId !== kid.memberId);
  existing.unshift({ ...kid, lastSignedIn: new Date().toISOString() });
  // Cap to 5 kids per device
  const trimmed = existing.slice(0, 5);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
}

export function forgetDeviceKid(memberId: string): void {
  const existing = listDeviceKids().filter((k) => k.memberId !== memberId);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
}
