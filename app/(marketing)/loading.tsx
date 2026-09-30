import { LoadingSpinner } from "@/components/ui/loading-spinner";

export default function Loading() {
  return (
    <LoadingSpinner
      message="Loading Content..."
      subMessage="Fetching latest deals and gadgets"
    />
  );
}