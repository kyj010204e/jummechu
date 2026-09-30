import type { ReactNode } from "react";

import ExplorationPanel from "@/components/ExplorationPanel";

export default function MapLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <>
      {children}
      <ExplorationPanel />
    </>
  );
}
