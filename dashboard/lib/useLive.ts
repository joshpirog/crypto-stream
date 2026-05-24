"use client";

import useSWR from "swr";

const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`request failed: ${r.status}`);
    return r.json();
  });

// Poll the route handlers every 5s; keep prior data so the UI doesn't flash on refresh.
export function useLive<T>(url: string) {
  return useSWR<T>(url, fetcher, {
    refreshInterval: 5000,
    keepPreviousData: true,
  });
}
