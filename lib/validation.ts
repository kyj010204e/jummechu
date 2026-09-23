export const MENU_IDS = ["korean", "noodle", "chicken", "pizza", "meat", "japanese", "burger", "chinese", "cafe"] as const;

export function parsePreferences(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MENU_IDS.length) return null;
  if (!value.every((item): item is string => typeof item === "string" && MENU_IDS.some((id) => id === item))) return null;
  return [...new Set(value)];
}

export function parseCoordinate(value: unknown, type: "latitude" | "longitude") {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !value.trim()) return null;
  const coordinate = Number(value);
  const limit = type === "latitude" ? 90 : 180;
  return Number.isFinite(coordinate) && Math.abs(coordinate) <= limit ? coordinate : null;
}

export function parseId(value: string) {
  if (!/^[1-9]\d{0,18}$/.test(value)) return null;
  const id = BigInt(value);
  return id <= BigInt("9223372036854775807") ? id : null;
}

export function parseName(value: unknown, maxLength = 100) {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name.length > 0 && name.length <= maxLength ? name : null;
}
