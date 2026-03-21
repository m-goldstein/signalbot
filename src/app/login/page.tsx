import { Suspense } from "react";
import { LoginForm } from "@/components/login-form";
import styles from "./page.module.css";

export default function LoginPage() {
  return (
    <div className={styles.page}>
      <main className={styles.panel}>
        <div className={styles.copy}>
          <h1>Signalbot login</h1>
          <p>Authentication is required to use this platform.</p>
        </div>
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </main>
    </div>
  );
}
