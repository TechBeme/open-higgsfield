import { Suspense } from "react";
import { ProviderSettings } from "@/features/providers/components/ProviderSettings";

export default function SettingsPage() {
    return <Suspense fallback={null}><ProviderSettings /></Suspense>;
}
