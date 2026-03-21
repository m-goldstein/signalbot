import { AppNav } from "@/components/app-nav";
import { ScreenerTable } from "@/components/screener-table";
import { getDefaultHistoryStartInput, getTodayInputValue } from "@/lib/screener/service";
import styles from "../page.module.css";

export default function ScreenerPage() {
  const initialHistoryStartInput = getDefaultHistoryStartInput();
  const maxHistoryStartInput = getTodayInputValue();

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <AppNav />

        <section className={styles.section}>
          <p>
            Direct screener route. This is the same primary module exposed on the home page.
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
