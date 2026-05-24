"use client";

import { useEffect, useState } from "react";

export default function Clock() {
  // Start empty and fill in on the client to avoid a hydration mismatch.
  const [now, setNow] = useState("--:--:--");

  useEffect(() => {
    const tick = () => setNow(new Date().toISOString().slice(11, 19));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <span className="tag tnum text-[var(--text-dim)]">
      {now} <span className="text-[var(--text-faint)]">UTC</span>
    </span>
  );
}
