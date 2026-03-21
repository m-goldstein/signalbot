import { AppNav } from "@/components/app-nav";
import { OpenInsiderDashboard } from "@/components/openinsider-dashboard";
import styles from "../page.module.css";

export default function OpenInsiderPage() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <AppNav />

        <section className={styles.section}>
          <p>
            OpenInsider is the secondary module for detailed insider-flow research, ticker clustering,
            role analysis, and GPT-assisted insider interpretation.
          </p>
        </section>

        <OpenInsiderDashboard />
      </main>
    </div>
  );
}
