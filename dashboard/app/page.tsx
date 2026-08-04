import Dashboard from "@/components/Dashboard";
import { DemoProvider } from "@/lib/demo/DemoProvider";

export default function Page() {
  return (
    <DemoProvider>
      <Dashboard />
    </DemoProvider>
  );
}
