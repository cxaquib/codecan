export function checkConnectivity(): Promise<boolean> {
  if (!navigator.onLine) return Promise.resolve(false);
  return fetch("https://huggingface.co/api/status", {
    method: "HEAD",
    signal: AbortSignal.timeout(5000),
  })
    .then(() => true)
    .catch(() => false);
}
