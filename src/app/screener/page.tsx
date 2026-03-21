import Link from "next/link";
import { ScreenerTable } from "@/components/screener-table";
import { LogoutButton } from "@/components/logout-button";
import styles from "./page.module.css";

export default function ScreenerPage() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <div className={styles.topBar}>
          <div className={styles.nav}>
            <Link href="/" className={styles.backLink}>
              Back to home
            </Link>
            <LogoutButton />
          </div>
        </div>
        <ScreenerTable />
      </main>
    </div>
  );
}
