export const API = "/api/v1"

export function getWsBase() {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:"
  return `${proto}//${window.location.host}/api/v1`
}
