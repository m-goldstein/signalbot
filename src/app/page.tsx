import Link from "next/link";
import { OpenInsiderDashboard } from "@/components/openinsider-dashboard";
import styles from "./page.module.css";

export default function Home() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <section className={styles.topBar}>
          <div className={styles.titleBlock}>
            <h1>Signalbot</h1>
            <p>Internal research tool for insider activity and market data.</p>
          </div>
          <nav className={styles.nav}>
            <Link href="/screener">Screener</Link>
          </nav>
        </section>

        <section className={styles.section}>
          <p>
            The OpenInsider view below fetches insider rows, aggregates them by ticker and date, and exposes the raw feed directly for inspection.
          </p>
        </section>

        <OpenInsiderDashboard />
      </main>
    </div>
  );
}
