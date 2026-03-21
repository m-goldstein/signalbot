import Link from "next/link";
import { ScreenerTable } from "@/components/screener-table";
import styles from "./page.module.css";

export default function ScreenerPage() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <div className={styles.topBar}>
          <Link href="/" className={styles.backLink}>
            Back to home
          </Link>
        </div>
        <ScreenerTable />
      </main>
    </div>
  );
}
