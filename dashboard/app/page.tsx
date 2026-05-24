import VwapChart from "@/components/VwapChart";
import MetricCards from "@/components/MetricCards";
import AnomalyFeed from "@/components/AnomalyFeed";
import HealthPanel from "@/components/HealthPanel";

export default function Page() {
  return (
    <main className="mx-auto max-w-7xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-gray-900">
          Crypto Market Intelligence
        </h1>
        <p className="text-sm text-gray-500">
          Live VWAP, anomalies, and pipeline health — streaming from Coinbase
          through Azure Event Hubs and Databricks.
        </p>
      </header>

      <MetricCards />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <VwapChart />
        </div>
        <HealthPanel />
      </div>

      <AnomalyFeed />
    </main>
  );
}
