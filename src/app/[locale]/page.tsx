import { Suspense } from "react";
import { StudioShell } from "@/features/studio/components/StudioShell";

export default function StudioPage() {
    return <Suspense fallback={null}><StudioShell /></Suspense>;
}
