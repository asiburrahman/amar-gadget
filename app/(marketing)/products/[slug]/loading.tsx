import { LoadingSpinner } from "@/components/ui/loading-spinner";

export default function Loading() {
  return (
    <LoadingSpinner
      message="Loading Product Details..."
      subMessage="Retrieving specifications, prices, and reviews"
    />
  );
}