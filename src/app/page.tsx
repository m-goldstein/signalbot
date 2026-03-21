import { AppNav } from "@/components/app-nav";
import { ScreenerTable } from "@/components/screener-table";
import { getDefaultHistoryStartInput, getTodayInputValue } from "@/lib/screener/service";
import styles from "./page.module.css";

export default function Home() {
  const initialHistoryStartInput = getDefaultHistoryStartInput();
  const maxHistoryStartInput = getTodayInputValue();

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

        <ScreenerTable
          initialHistoryStartInput={initialHistoryStartInput}
          maxHistoryStartInput={maxHistoryStartInput}
        />
      </main>
    </div>
  );
}
