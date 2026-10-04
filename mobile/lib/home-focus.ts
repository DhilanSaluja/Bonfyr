/** One-shot flag so Home can jump to Live Sparks after you light one. */
let showSparks = false;

export function requestShowLiveSparks() {
  showSparks = true;
}

export function takeShowLiveSparks(): boolean {
  const next = showSparks;
  showSparks = false;
  return next;
}
