import { LoadingSpinner } from "@/components/ui/loading-spinner";

export default function Loading() {
  return (
    <LoadingSpinner
      message="Loading Products..."
      subMessage="Fetching verified electronics from database"
    />
  );
}