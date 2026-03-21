"use client";

import { useEffect, useState } from "react";
import { ScreenerTable } from "@/components/screener-table";

type ScreenerTableShellProps = {
  initialHistoryStartInput: string;
  maxHistoryStartInput: string;
};

export function ScreenerTableShell(props: ScreenerTableShellProps) {
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  if (!isMounted) {
    return null;
  }

  return <ScreenerTable {...props} />;
}
