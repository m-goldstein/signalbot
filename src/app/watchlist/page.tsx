import { AppNav } from "@/components/app-nav";
import { WatchlistPanel } from "@/components/watchlist-panel";
import styles from "@/app/page.module.css";

export default function WatchlistPage() {
  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <AppNav />
        <WatchlistPanel />
      </main>
    </div>
  );
}
