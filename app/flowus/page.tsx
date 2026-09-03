"use client";

import { useRouter } from "next/navigation";
import { FlowusWorkbench } from "@/components/flowus/flowus-workbench";

export default function FlowusPage() {
  const router = useRouter();
  return <FlowusWorkbench onClose={() => router.back()} />;
}
