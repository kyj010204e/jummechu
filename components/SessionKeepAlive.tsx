"use client";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
const REFRESH_INTERVAL = 60 * 60 * 1000;
export default function SessionKeepAlive() {
  const pathname = usePathname();
  const lastSuccess = useRef(0);
  const lastAttempt = useRef(0);
  useEffect(() => {
    let active = true;
    let pending = false;
    const controller = new AbortController();
    async function refreshSession(force = false) {
      const now = Date.now();
      if (pending || (!force && (now - lastSuccess.current < REFRESH_INTERVAL || now - lastAttempt.current < 60_000))) return;
      pending = true;
      lastAttempt.current = now;
      try {
        const response = await fetch("/api/session/refresh", { method: "POST", credentials: "include", signal: controller.signal });
        if (response.ok && active) lastSuccess.current = Date.now();
        else if (response.status !== 401 && active) console.error("세션 갱신 실패:", response.status);
      } catch (error) {
        if (active) console.error("세션 갱신 오류:", error);
      } finally {
        pending = false;
      }
    }
    const activity = () => { void refreshSession(); };
    const authenticated = () => { lastSuccess.current = 0; lastAttempt.current = 0; void refreshSession(true); };
    void refreshSession();
    for (const event of ["focus", "pointerdown", "keydown", "touchstart"]) window.addEventListener(event, activity);
    window.addEventListener("jummechu-authenticated", authenticated);
    return () => {
      active = false;
      controller.abort();
      for (const event of ["focus", "pointerdown", "keydown", "touchstart"]) window.removeEventListener(event, activity);
      window.removeEventListener("jummechu-authenticated", authenticated);
    };
  }, [pathname]);
  return null;
}
