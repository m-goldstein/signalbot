import { AppNav } from "@/components/app-nav";
import { ScreenerTable } from "@/components/screener-table";
import styles from "./page.module.css";

export default function Home() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <AppNav />

        <section className={styles.section}>
          <p>
            The screener is the primary module. Use it for daily technical and options-oriented
            ranking, filtering, chart inspection, and GPT review across the tracked universe.
          </p>
        </section>

        <ScreenerTable />
      </main>
    </div>
  );
}
