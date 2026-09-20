import { Suspense } from "react";
import LoginForm from "./LoginForm";

// Dibungkus Suspense karena LoginForm (client component) memakai
// useSearchParams() (dipakai buat baca ?deactivated=1 — lihat LoginForm.tsx)
// yang mewajibkan boundary Suspense di Next.js App Router.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
