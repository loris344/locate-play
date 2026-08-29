import { Suspense } from "react";
import Auth from "@/screens/Auth";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <Auth />
    </Suspense>
  );
}
