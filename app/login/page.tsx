import { Suspense } from "react";
import type { Metadata } from "next";
import LoginForm from "../LoginForm";

export const metadata: Metadata = { title: "Masuk" };

// LoginForm memakai useSearchParams() (untuk ?deactivated=1), yang di Next 14
// wajib dibungkus <Suspense> supaya `next build` tidak gagal.
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
