import { Suspense } from "react";
import { LoginForm } from "@/components/login-form";
import styles from "./page.module.css";

export default function LoginPage() {
  return (
    <div className={styles.page}>
      <main className={styles.panel}>
        <div className={styles.copy}>
          <h1>Wolfdesk login</h1>
          <p>Authentication is required to use this platform. Please reach out to the administrator if you would like access.</p>
        </div>
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </main>
    </div>
  );
}
