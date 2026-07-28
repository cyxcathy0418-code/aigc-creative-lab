import type { Metadata } from "next";
import { ConfirmClient } from "./ConfirmClient";

export const metadata: Metadata = {
  title: "验证登录",
};

export default function ConfirmPage() {
  return (
    <main className="auth-confirm-shell">
      <ConfirmClient />
    </main>
  );
}
