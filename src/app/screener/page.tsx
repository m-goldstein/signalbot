import { AppNav } from "@/components/app-nav";
import { ScreenerTable } from "@/components/screener-table";
import styles from "../page.module.css";

export default function ScreenerPage() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <AppNav />

        <section className={styles.section}>
          <p>
            Direct screener route. This is the same primary module exposed on the home page.
          </p>
        </section>

        <ScreenerTable />
      </main>
    </div>
  );
}
